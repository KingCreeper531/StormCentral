import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, countDistinct, desc, eq, inArray, or } from "drizzle-orm";
import {
  AUTO_HIDE_FLAGS,
  avatarUrl,
  PERMANENT_SUSPENSION,
  type BlockedUserDto,
  type FlagReason,
  type FlagTarget,
  type QueueItemDto,
} from "../community";
import { getDb } from "../db/client";
import { blocks, comments, flags, posts, users } from "../db/schema";
import { deleteComment, deletePost, getComment, getPostOwner } from "./community-repo";

const DAY = 86_400_000;

/* ---------- Blocking ---------- */

export async function findUserId(username: string) {
  const db = await getDb();
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
  return row?.id ?? null;
}

export async function listBlocked(userId: string): Promise<BlockedUserDto[]> {
  const db = await getDb();
  const rows = await db
    .select({ username: users.username, displayName: users.displayName, avatarHue: users.avatarHue, avatarMediaId: users.avatarMediaId, blockedAt: blocks.createdAt })
    .from(blocks)
    .innerJoin(users, eq(blocks.blockedId, users.id))
    .where(eq(blocks.blockerId, userId))
    .orderBy(desc(blocks.createdAt));
  return rows.map(({ avatarMediaId, ...r }) => ({ ...r, avatarUrl: avatarUrl(avatarMediaId) }));
}

export async function block(blockerId: string, blockedId: string) {
  const db = await getDb();
  await db.insert(blocks).values({ blockerId, blockedId, createdAt: Date.now() }).onConflictDoNothing();
}

export async function unblock(blockerId: string, blockedId: string) {
  const db = await getDb();
  await db.delete(blocks).where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
}

/** Whether `blockerId` has blocked `blockedId` (one direction). */
export async function isBlocking(blockerId: string, blockedId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
    .limit(1);
  return !!row;
}

/** Whether either person has blocked the other: they can't interact. */
export async function blockedBetween(a: string, b: string) {
  if (a === b) return false;
  const db = await getDb();
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))))
    .limit(1);
  return !!row;
}

/* ---------- Flags ---------- */

/** The author of a flag target, or null when it doesn't exist. */
async function targetOwner(type: FlagTarget, id: string): Promise<string | null> {
  const db = await getDb();
  if (type === "post") return (await getPostOwner(id))?.userId ?? null;
  if (type === "comment") {
    const [row] = await db.select({ userId: comments.userId }).from(comments).where(eq(comments.id, id));
    return row?.userId ?? null;
  }
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, id));
  return row?.id ?? null;
}

export type FlagResult = { ok: true; hidden: boolean } | { ok: false; status: 400 | 404; error: string };

/**
 * Records one person's flag (repeat flags of the same thing are ignored).
 * Enough open flags from different people hide a report or comment from
 * everyone but its author until a moderator reviews it.
 */
export async function createFlag(reporterId: string, input: { type: FlagTarget; id: string; reason: FlagReason; details?: string }): Promise<FlagResult> {
  const owner = await targetOwner(input.type, input.id);
  if (!owner) return { ok: false, status: 404, error: "That no longer exists" };
  if (owner === reporterId) return { ok: false, status: 400, error: "You can't report your own content" };
  const db = await getDb();
  // Accounts are flagged by user id so a rename doesn't orphan the flag.
  const targetId = input.type === "user" ? owner : input.id;
  await db
    .insert(flags)
    .values({ id: randomUUID(), reporterId, targetType: input.type, targetId, reason: input.reason, details: input.details || null, createdAt: Date.now() })
    .onConflictDoNothing();
  if (input.type === "user") return { ok: true, hidden: false };

  const [row] = await db
    .select({ n: countDistinct(flags.reporterId) })
    .from(flags)
    .where(and(eq(flags.targetType, input.type), eq(flags.targetId, targetId), eq(flags.status, "open")));
  const hide = Number(row?.n ?? 0) >= AUTO_HIDE_FLAGS;
  if (hide) {
    if (input.type === "post") await db.update(posts).set({ hidden: 1 }).where(eq(posts.id, targetId));
    else await db.update(comments).set({ hidden: 1 }).where(eq(comments.id, targetId));
  }
  return { ok: true, hidden: hide };
}

async function closeFlags(type: FlagTarget, targetId: string, status: "kept" | "removed" | "actioned") {
  const db = await getDb();
  await db
    .update(flags)
    .set({ status, resolvedAt: Date.now() })
    .where(and(eq(flags.targetType, type), eq(flags.targetId, targetId), eq(flags.status, "open")));
}

/* ---------- Moderation queue ---------- */

const QUEUE_LIMIT = 50;

/** Open flags grouped by what they flag, oldest first, with the flagged content. */
export async function moderationQueue(): Promise<QueueItemDto[]> {
  const db = await getDb();
  const open = await db
    .select({
      targetType: flags.targetType,
      targetId: flags.targetId,
      reason: flags.reason,
      details: flags.details,
      createdAt: flags.createdAt,
      reporter: users.username,
    })
    .from(flags)
    .innerJoin(users, eq(flags.reporterId, users.id))
    .where(eq(flags.status, "open"))
    .orderBy(asc(flags.createdAt))
    .limit(1000);

  const groups = new Map<string, QueueItemDto>();
  for (const f of open) {
    const key = `${f.targetType}:${f.targetId}`;
    let item = groups.get(key);
    if (!item) {
      if (groups.size >= QUEUE_LIMIT) continue;
      item = {
        type: f.targetType as FlagTarget,
        id: f.targetId,
        hidden: false,
        firstFlaggedAt: f.createdAt,
        flags: [],
        author: null,
        body: null,
        image: null,
        createdAt: null,
        postId: null,
      };
      groups.set(key, item);
    }
    item.flags.push({ reason: f.reason as FlagReason, details: f.details, reporter: f.reporter, createdAt: f.createdAt });
  }
  const items = [...groups.values()];
  const idsOf = (t: FlagTarget) => items.filter((i) => i.type === t).map((i) => i.id);
  const author = (u: { username: string; displayName: string; avatarHue: number; avatarMediaId: string | null; suspendedUntil: number | null }) => ({
    username: u.username,
    displayName: u.displayName,
    avatarHue: u.avatarHue,
    avatarUrl: avatarUrl(u.avatarMediaId),
    suspendedUntil: u.suspendedUntil != null && u.suspendedUntil > Date.now() ? u.suspendedUntil : null,
  });
  const userCols = { username: users.username, displayName: users.displayName, avatarHue: users.avatarHue, avatarMediaId: users.avatarMediaId, suspendedUntil: users.suspendedUntil };

  const postIds = idsOf("post");
  const postRows = postIds.length
    ? await db
        .select({ id: posts.id, body: posts.body, mediaId: posts.mediaId, hidden: posts.hidden, createdAt: posts.createdAt, ...userCols })
        .from(posts)
        .innerJoin(users, eq(posts.userId, users.id))
        .where(inArray(posts.id, postIds))
    : [];
  const commentIds = idsOf("comment");
  const commentRows = commentIds.length
    ? await db
        .select({ id: comments.id, body: comments.body, postId: comments.postId, hidden: comments.hidden, createdAt: comments.createdAt, ...userCols })
        .from(comments)
        .innerJoin(users, eq(comments.userId, users.id))
        .where(inArray(comments.id, commentIds))
    : [];
  const userIds = idsOf("user");
  const userRows = userIds.length ? await db.select({ id: users.id, bio: users.bio, createdAt: users.createdAt, ...userCols }).from(users).where(inArray(users.id, userIds)) : [];

  for (const item of items) {
    if (item.type === "post") {
      const p = postRows.find((r) => r.id === item.id);
      if (!p) continue;
      Object.assign(item, { author: author(p), body: p.body, image: p.mediaId ? `/api/media/${p.mediaId}` : null, createdAt: p.createdAt, hidden: p.hidden !== 0 });
    } else if (item.type === "comment") {
      const c = commentRows.find((r) => r.id === item.id);
      if (!c) continue;
      Object.assign(item, { author: author(c), body: c.body, createdAt: c.createdAt, postId: c.postId, hidden: c.hidden !== 0 });
    } else {
      const u = userRows.find((r) => r.id === item.id);
      if (!u) continue;
      Object.assign(item, { author: author(u), body: u.bio, image: avatarUrl(u.avatarMediaId), createdAt: u.createdAt });
    }
  }
  // Content deleted since it was flagged has nothing left to review.
  const gone = items.filter((i) => !i.author);
  await Promise.all(gone.map((i) => closeFlags(i.type, i.id, "removed")));
  return items.filter((i) => i.author);
}

/* ---------- Moderator actions ---------- */

export async function keepContent(type: FlagTarget, id: string) {
  const db = await getDb();
  if (type === "post") await db.update(posts).set({ hidden: 0 }).where(eq(posts.id, id));
  if (type === "comment") await db.update(comments).set({ hidden: 0 }).where(eq(comments.id, id));
  await closeFlags(type, id, "kept");
}

export async function removeContent(type: "post" | "comment", id: string): Promise<boolean> {
  if (type === "post") {
    const owner = await getPostOwner(id);
    if (!owner) return false;
    await deletePost(id, owner.mediaId); // also deletes its flags
  } else {
    if (!(await getComment(id))) return false;
    await deleteComment(id);
  }
  return true;
}

/** Suspends an account (0 days = permanently) and closes the flags against it. */
export async function suspendUser(userId: string, days: number) {
  const db = await getDb();
  const until = days === 0 ? PERMANENT_SUSPENSION : Date.now() + days * DAY;
  await db.update(users).set({ suspendedUntil: until }).where(eq(users.id, userId));
  await closeFlags("user", userId, "actioned");
  return until;
}

export async function unsuspendUser(userId: string) {
  const db = await getDb();
  await db.update(users).set({ suspendedUntil: null }).where(eq(users.id, userId));
}
