import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { CommentDto, ConditionsSnapshot, FeedResponse, PostDto } from "../community";
import { conditionsSchema } from "../community";
import { getDb } from "../db/client";
import { comments, media, posts, users, verifications } from "../db/schema";
import { haversineKm, type BBox, type LatLon } from "../geo";

const PAGE = 20;

/** Reputation = verifications received across all of a user's posts. */
const reputationSql = sql<number>`(
  SELECT COUNT(*) FROM verifications v JOIN posts p2 ON p2.id = v.post_id WHERE p2.user_id = ${users.id}
)`;

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
  const where = [];
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
  const commentCount = sql<number>`(SELECT COUNT(*) FROM comments c WHERE c.post_id = ${posts.id})`;

  const rows = await db
    .select({
      post: posts,
      username: users.username,
      displayName: users.displayName,
      avatarHue: users.avatarHue,
      reputation: reputationSql,
      verifications: verifyCount,
      comments: commentCount,
      mediaWidth: media.width,
      mediaHeight: media.height,
    })
    .from(posts)
    .innerJoin(users, eq(posts.userId, users.id))
    .leftJoin(media, eq(posts.mediaId, media.id))
    .where(where.length ? and(...where) : undefined)
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
    author: { username: r.username, displayName: r.displayName, avatarHue: r.avatarHue, reputation: Number(r.reputation) },
    verifications: Number(r.verifications),
    comments: Number(r.comments),
    viewerVerified: mine.has(r.post.id),
    isOwn: viewerId === r.post.userId,
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
  const children = [
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

export async function listComments(postId: string, viewerId: string | null): Promise<CommentDto[]> {
  const db = await getDb();
  const rows = await db
    .select({ c: comments, username: users.username, displayName: users.displayName, avatarHue: users.avatarHue })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.postId, postId))
    .orderBy(comments.createdAt)
    .limit(200);
  return rows.map((r) => ({
    id: r.c.id,
    body: r.c.body,
    createdAt: r.c.createdAt,
    author: { username: r.username, displayName: r.displayName, avatarHue: r.avatarHue },
    isOwn: r.c.userId === viewerId,
  }));
}

export async function addComment(postId: string, userId: string, body: string) {
  const db = await getDb();
  const id = randomUUID();
  await db.insert(comments).values({ id, postId, userId, body, createdAt: Date.now() });
  return id;
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
      bio: users.bio,
      createdAt: users.createdAt,
      reputation: reputationSql,
      posts: sql<number>`(SELECT COUNT(*) FROM posts p WHERE p.user_id = ${users.id})`,
    })
    .from(users)
    .where(eq(users.username, username));
  return row ? { ...row, reputation: Number(row.reputation), posts: Number(row.posts) } : null;
}
