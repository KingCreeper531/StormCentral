import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { ActivityItem, CommentDto, ConditionsSnapshot, FeedResponse, PostDto } from "../community";
import { avatarUrl, conditionsSchema } from "../community";
import { isDeveloper, isTrustedSpotter } from "../auth/session";
import { getDb } from "../db/client";
import { comments, flags, media, posts, users, verifications } from "../db/schema";
import { haversineKm, type BBox, type LatLon } from "../geo";
import { NWS_BONUS, parseNwsRef } from "../nws-match";

const PAGE = 20;

/**
 * Reputation = confirmations received across a user's reports, plus NWS_BONUS
 * for each report the NWS confirmed. Written against the outer query's `users`
 * table by name: Drizzle leaves columns unqualified in single-table selects
 * (the profile), where `id` would bind to the subquery's posts.
 */
export const reputationSql = sql<number>`(
  (SELECT COUNT(*) FROM verifications v JOIN posts p2 ON p2.id = v.post_id WHERE p2.user_id = "users"."id")
  + ${sql.raw(String(NWS_BONUS))} * (SELECT COUNT(*) FROM posts p3 WHERE p3.user_id = "users"."id" AND p3.nws_confirmed_at IS NOT NULL)
)`;

/** No block between the viewer and the user in `userCol`, in either direction. */
export function notBlocked(viewerId: string | null, userCol: SQL | typeof posts.userId | typeof comments.userId): SQL | undefined {
  if (!viewerId) return undefined;
  return sql`NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ${userCol}) OR (b.blocker_id = ${userCol} AND b.blocked_id = ${viewerId}))`;
}

/**
 * What others may see: content that isn't hidden for review, from accounts
 * that aren't suspended. Authors always see their own.
 */
function visible(viewerId: string | null, hidden: typeof posts.hidden | typeof comments.hidden, userId: typeof posts.userId | typeof comments.userId, now: number) {
  const shown = and(eq(hidden, 0), or(isNull(users.suspendedUntil), lte(users.suspendedUntil, now)));
  return viewerId ? or(eq(userId, viewerId), shown) : shown;
}

export type FeedQuery =
  | { sort: "latest"; cursor?: string | null }
  | { sort: "nearby"; origin: LatLon; radiusKm: number; cursor?: string | null }
  | { sort: "top"; hours: number }
  | { sort: "bbox"; bbox: BBox; hours: number }
  | { sort: "user"; username: string; cursor?: string | null };

function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  const [t, id] = cursor.split("_");
  const createdAt = Number(t);
  return Number.isFinite(createdAt) && id ? { createdAt, id } : null;
}

export async function listPosts(q: FeedQuery, viewerId: string | null): Promise<FeedResponse> {
  const db = await getDb();
  const now = Date.now();
  const where: (SQL | undefined)[] = [visible(viewerId, posts.hidden, posts.userId, now), notBlocked(viewerId, posts.userId)];
  let limit = PAGE;

  if ("cursor" in q) {
    const c = decodeCursor(q.cursor);
    if (c) where.push(or(lt(posts.createdAt, c.createdAt), and(eq(posts.createdAt, c.createdAt), lt(posts.id, c.id))));
  }
  if (q.sort === "nearby") {
    const dLat = q.radiusKm / 111;
    const dLon = q.radiusKm / (111 * Math.max(0.1, Math.cos((q.origin.lat * Math.PI) / 180)));
    where.push(
      gte(posts.lat, q.origin.lat - dLat),
      lte(posts.lat, q.origin.lat + dLat),
      gte(posts.lon, q.origin.lon - dLon),
      lte(posts.lon, q.origin.lon + dLon),
    );
  }
  if (q.sort === "top" || q.sort === "bbox") where.push(gte(posts.createdAt, Date.now() - q.hours * 3_600_000));
  if (q.sort === "bbox") {
    where.push(gte(posts.lat, q.bbox.south), lte(posts.lat, q.bbox.north), gte(posts.lon, q.bbox.west), lte(posts.lon, q.bbox.east));
    limit = 300;
  }
  if (q.sort === "user") where.push(eq(users.username, q.username));

  const verifyCount = sql<number>`(SELECT COUNT(*) FROM verifications v WHERE v.post_id = ${posts.id})`;
  // Counts only the comments this viewer would see.
  const commentCount = sql<number>`(SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id = c.user_id WHERE c.post_id = ${posts.id}
    AND (c.user_id = ${viewerId ?? ""} OR (c.hidden = 0 AND (cu.suspended_until IS NULL OR cu.suspended_until <= ${now})))
    ${viewerId ? sql`AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = c.user_id) OR (b.blocker_id = c.user_id AND b.blocked_id = ${viewerId}))` : sql``})`;

  const rows = await db
    .select({
      post: posts,
      username: users.username,
      displayName: users.displayName,
      avatarHue: users.avatarHue,
      avatarMediaId: users.avatarMediaId,
      reputation: reputationSql,
      verifications: verifyCount,
      comments: commentCount,
      mediaWidth: media.width,
      mediaHeight: media.height,
    })
    .from(posts)
    .innerJoin(users, eq(posts.userId, users.id))
    .leftJoin(media, eq(posts.mediaId, media.id))
    .where(and(...where))
    .orderBy(...(q.sort === "top" ? [desc(verifyCount), desc(posts.createdAt)] : [desc(posts.createdAt), desc(posts.id)]))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const ids = page.map((r) => r.post.id);
  const mine = viewerId && ids.length
    ? new Set(
        (
          await db
            .select({ postId: verifications.postId })
            .from(verifications)
            .where(and(eq(verifications.userId, viewerId), inArray(verifications.postId, ids)))
        ).map((r) => r.postId),
      )
    : new Set<string>();

  let out: PostDto[] = page.map((r) => ({
    id: r.post.id,
    body: r.post.body,
    category: r.post.category as PostDto["category"],
    severity: r.post.severity,
    lat: r.post.lat,
    lon: r.post.lon,
    place: r.post.place,
    createdAt: r.post.createdAt,
    image: r.post.mediaId ? { url: `/api/media/${r.post.mediaId}`, width: r.mediaWidth, height: r.mediaHeight } : null,
    conditions: parseConditions(r.post.conditions),
    author: {
      username: r.username,
      displayName: r.displayName,
      avatarHue: r.avatarHue,
      avatarUrl: avatarUrl(r.avatarMediaId),
      reputation: Number(r.reputation),
      developer: isDeveloper(r.username),
      trusted: isTrustedSpotter(r.username),
    },
    verifications: Number(r.verifications),
    comments: Number(r.comments),
    viewerVerified: mine.has(r.post.id),
    isOwn: viewerId === r.post.userId,
    hidden: r.post.hidden !== 0,
    nws: parseNwsRef(r.post.nwsReport),
  }));

  if (q.sort === "nearby") {
    out = out
      .map((p) => ({ ...p, distanceKm: haversineKm(q.origin, p) }))
      .filter((p) => p.distanceKm! <= q.radiusKm);
  }
  const last = page.at(-1);
  const hasMore = rows.length > limit && q.sort !== "top" && q.sort !== "bbox";
  return { posts: out, nextCursor: hasMore && last ? `${last.post.createdAt}_${last.post.id}` : null };
}

function parseConditions(json: string | null): ConditionsSnapshot | null {
  if (!json) return null;
  try {
    const r = conditionsSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function createPost(input: {
  userId: string;
  body: string;
  category: string;
  severity: number;
  lat: number;
  lon: number;
  place?: string;
  precise?: boolean;
  conditions: ConditionsSnapshot | null;
  image: { bytes: Uint8Array; mime: string; width: number | null; height: number | null } | null;
}) {
  const db = await getDb();
  const now = Date.now();
  const id = randomUUID();
  const mediaId = input.image ? randomUUID() : null;
  // ~1.1 km default precision protects home locations; opt-in ~110 m.
  const digits = input.precise ? 3 : 2;
  const round = (v: number) => Math.round(v * 10 ** digits) / 10 ** digits;

  await db.transaction(async (tx) => {
    if (input.image && mediaId) {
      await tx.insert(media).values({
        id: mediaId,
        userId: input.userId,
        mime: input.image.mime,
        width: input.image.width,
        height: input.image.height,
        size: input.image.bytes.byteLength,
        bytes: Buffer.from(input.image.bytes),
        createdAt: now,
      });
    }
    await tx.insert(posts).values({
      id,
      userId: input.userId,
      body: input.body,
      category: input.category,
      severity: input.severity,
      lat: round(input.lat),
      lon: round(input.lon),
      place: input.place || null,
      mediaId,
      conditions: input.conditions ? JSON.stringify(input.conditions) : null,
      createdAt: now,
    });
  });
  return id;
}

export async function getPostOwner(postId: string) {
  const db = await getDb();
  const [row] = await db.select({ userId: posts.userId, mediaId: posts.mediaId }).from(posts).where(eq(posts.id, postId));
  return row ?? null;
}

/** Explicit cascade (libSQL's connection pool doesn't guarantee PRAGMA foreign_keys). */
export async function deletePost(postId: string, mediaId: string | null) {
  const db = await getDb();
  const commentIds = (await db.select({ id: comments.id }).from(comments).where(eq(comments.postId, postId))).map((c) => c.id);
  const children = [
    db.delete(flags).where(and(eq(flags.targetType, "post"), eq(flags.targetId, postId))),
    db.delete(flags).where(and(eq(flags.targetType, "comment"), inArray(flags.targetId, commentIds.length ? commentIds : [""]))),
    db.delete(verifications).where(eq(verifications.postId, postId)),
    db.delete(comments).where(eq(comments.postId, postId)),
    db.delete(posts).where(eq(posts.id, postId)),
  ] as const;
  await (mediaId ? db.batch([...children, db.delete(media).where(eq(media.id, mediaId))]) : db.batch(children));
}

export async function toggleVerification(postId: string, userId: string) {
  const db = await getDb();
  const existing = await db
    .select({ postId: verifications.postId })
    .from(verifications)
    .where(and(eq(verifications.postId, postId), eq(verifications.userId, userId)));
  if (existing.length) {
    await db.delete(verifications).where(and(eq(verifications.postId, postId), eq(verifications.userId, userId)));
  } else {
    await db.insert(verifications).values({ postId, userId, createdAt: Date.now() }).onConflictDoNothing();
  }
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(verifications)
    .where(eq(verifications.postId, postId));
  return { verified: !existing.length, count: Number(row?.n ?? 0) };
}

/**
 * Confirmations and visible comments by other people on `userId`'s reports,
 * and the NWS confirming one, since `since` (epoch ms), newest last, skipping
 * accounts either side blocked.
 */
export async function listActivity(userId: string, since: number, limit = 30): Promise<ActivityItem[]> {
  const db = await getDb();
  const now = Date.now();
  const preview = (body: string) => body.replace(/\s+/g, " ").trim().slice(0, 80);
  const shownUser = or(isNull(users.suspendedUntil), lte(users.suspendedUntil, now));
  const [confirms, replies, nws] = await Promise.all([
    db
      .select({ postId: verifications.postId, at: verifications.createdAt, body: posts.body, username: users.username, displayName: users.displayName })
      .from(verifications)
      .innerJoin(posts, eq(posts.id, verifications.postId))
      .innerJoin(users, eq(users.id, verifications.userId))
      .where(and(eq(posts.userId, userId), sql`${verifications.userId} <> ${userId}`, gte(verifications.createdAt, since), shownUser, notBlocked(userId, sql`${verifications.userId}`)))
      .orderBy(desc(verifications.createdAt))
      .limit(limit),
    db
      .select({ id: comments.id, postId: comments.postId, at: comments.createdAt, text: comments.body, body: posts.body, username: users.username, displayName: users.displayName })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .innerJoin(users, eq(users.id, comments.userId))
      .where(and(eq(posts.userId, userId), sql`${comments.userId} <> ${userId}`, gte(comments.createdAt, since), eq(comments.hidden, 0), shownUser, notBlocked(userId, comments.userId)))
      .orderBy(desc(comments.createdAt))
      .limit(limit),
    db
      .select({ postId: posts.id, at: posts.nwsConfirmedAt, body: posts.body })
      .from(posts)
      .where(and(eq(posts.userId, userId), gte(posts.nwsConfirmedAt, since)))
      .orderBy(desc(posts.nwsConfirmedAt))
      .limit(limit),
  ]);
  const items: ActivityItem[] = [
    ...confirms.map((r) => ({
      id: `v:${r.postId}:${r.username}`,
      kind: "confirm" as const,
      at: r.at,
      postId: r.postId,
      postPreview: preview(r.body),
      actor: { username: r.username, displayName: r.displayName },
      text: null,
    })),
    ...replies.map((r) => ({
      id: `c:${r.id}`,
      kind: "comment" as const,
      at: r.at,
      postId: r.postId,
      postPreview: preview(r.body),
      actor: { username: r.username, displayName: r.displayName },
      text: r.text.slice(0, 300),
    })),
    ...nws.map((r) => ({
      id: `n:${r.postId}`,
      kind: "nws" as const,
      at: r.at ?? 0,
      postId: r.postId,
      postPreview: preview(r.body),
      actor: { username: "", displayName: "National Weather Service" },
      text: null,
    })),
  ];
  return items.sort((a, b) => a.at - b.at).slice(-limit);
}

export async function listComments(postId: string, viewerId: string | null): Promise<CommentDto[]> {
  const db = await getDb();
  const rows = await db
    .select({ c: comments, username: users.username, displayName: users.displayName, avatarHue: users.avatarHue, avatarMediaId: users.avatarMediaId })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(and(eq(comments.postId, postId), visible(viewerId, comments.hidden, comments.userId, Date.now()), notBlocked(viewerId, comments.userId)))
    .orderBy(comments.createdAt)
    .limit(200);
  return rows.map((r) => ({
    id: r.c.id,
    body: r.c.body,
    createdAt: r.c.createdAt,
    author: {
      username: r.username,
      displayName: r.displayName,
      avatarHue: r.avatarHue,
      avatarUrl: avatarUrl(r.avatarMediaId),
      developer: isDeveloper(r.username),
      trusted: isTrustedSpotter(r.username),
    },
    isOwn: r.c.userId === viewerId,
    hidden: r.c.hidden !== 0,
  }));
}

export async function addComment(postId: string, userId: string, body: string) {
  const db = await getDb();
  const id = randomUUID();
  await db.insert(comments).values({ id, postId, userId, body, createdAt: Date.now() });
  return id;
}

export async function getComment(id: string) {
  const db = await getDb();
  const [row] = await db.select({ userId: comments.userId, postId: comments.postId }).from(comments).where(eq(comments.id, id));
  return row ?? null;
}

export async function deleteComment(id: string) {
  const db = await getDb();
  await db.batch([db.delete(flags).where(and(eq(flags.targetType, "comment"), eq(flags.targetId, id))), db.delete(comments).where(eq(comments.id, id))]);
}

export async function getMedia(id: string) {
  const db = await getDb();
  const [row] = await db.select({ mime: media.mime, bytes: media.bytes }).from(media).where(eq(media.id, id));
  return row ?? null;
}

export async function getProfile(username: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarHue: users.avatarHue,
      avatarMediaId: users.avatarMediaId,
      bio: users.bio,
      createdAt: users.createdAt,
      suspendedUntil: users.suspendedUntil,
      reputation: reputationSql,
      posts: sql<number>`(SELECT COUNT(*) FROM posts p WHERE p.user_id = "users"."id")`,
      nwsConfirmed: sql<number>`(SELECT COUNT(*) FROM posts p WHERE p.user_id = "users"."id" AND p.nws_confirmed_at IS NOT NULL)`,
    })
    .from(users)
    .where(eq(users.username, username));
  if (!row) return null;
  // An expired suspension reads as none.
  const suspendedUntil = row.suspendedUntil != null && row.suspendedUntil > Date.now() ? row.suspendedUntil : null;
  return {
    ...row,
    suspendedUntil,
    avatarUrl: avatarUrl(row.avatarMediaId),
    reputation: Number(row.reputation),
    posts: Number(row.posts),
    nwsConfirmed: Number(row.nwsConfirmed),
    developer: isDeveloper(row.username),
    trusted: isTrustedSpotter(row.username),
  };
}
