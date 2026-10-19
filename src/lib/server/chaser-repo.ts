import "server-only";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { isDeveloper, isTrustedSpotter } from "../auth/session";
import { CHASER_MAX_AGE_MS, MAX_SHARE_MS, parseStream, roundCoord, type ChaserDto, type PositionInput } from "../chasers";
import { avatarUrl } from "../community";
import { getDb } from "../db/client";
import { chaserPositions, users } from "../db/schema";
import { notBlocked, reputationSql as reputation } from "./community-repo";

/** Saves my latest position; sharing ends at `until`, never more than 12 hours out. Returns that end. */
export async function upsertPosition(userId: string, p: PositionInput, now = Date.now()): Promise<number> {
  const db = await getDb();
  const fields = {
    lat: roundCoord(p.lat),
    lon: roundCoord(p.lon),
    heading: p.heading == null ? null : Math.round(p.heading) % 360,
    speedKmh: p.speedKmh == null ? null : Math.round(p.speedKmh),
    accuracyM: p.accuracyM == null ? null : Math.round(p.accuracyM),
    // Kept in its checked form; anything that isn't a YouTube link is dropped.
    stream: parseStream(p.stream)?.url ?? null,
    updatedAt: now,
    expiresAt: Math.min(p.until, now + MAX_SHARE_MS),
  };
  await db
    .insert(chaserPositions)
    .values({ userId, ...fields })
    .onConflictDoUpdate({ target: chaserPositions.userId, set: fields });
  return fields.expiresAt;
}

/** Stops sharing: the position is deleted, not kept. */
export async function stopSharing(userId: string) {
  const db = await getDb();
  await db.delete(chaserPositions).where(eq(chaserPositions.userId, userId));
}

/** Deletes positions past their window or too old to show, so nothing lingers. */
export async function pruneChasers(now = Date.now()) {
  const db = await getDb();
  await db.delete(chaserPositions).where(or(lte(chaserPositions.expiresAt, now), lte(chaserPositions.updatedAt, now - CHASER_MAX_AGE_MS)));
}

/**
 * Chasers sharing right now (updated in the last 15 minutes, window not
 * ended), newest first. Suspended accounts and anyone either side of a block
 * are left out; my own position always shows.
 */
export async function listChasers(viewerId: string, now = Date.now()): Promise<ChaserDto[]> {
  const db = await getDb();
  const rows = await db
    .select({
      p: chaserPositions,
      username: users.username,
      displayName: users.displayName,
      avatarHue: users.avatarHue,
      avatarMediaId: users.avatarMediaId,
      reputation,
    })
    .from(chaserPositions)
    .innerJoin(users, eq(users.id, chaserPositions.userId))
    .where(
      and(
        gt(chaserPositions.updatedAt, now - CHASER_MAX_AGE_MS),
        gt(chaserPositions.expiresAt, now),
        or(eq(chaserPositions.userId, viewerId), isNull(users.suspendedUntil), lte(users.suspendedUntil, now)),
        notBlocked(viewerId, sql`${chaserPositions.userId}`),
      ),
    )
    .orderBy(desc(chaserPositions.updatedAt))
    .limit(500);
  return rows.map((r) => ({
    username: r.username,
    displayName: r.displayName,
    avatarHue: r.avatarHue,
    avatarUrl: avatarUrl(r.avatarMediaId),
    reputation: Number(r.reputation),
    developer: isDeveloper(r.username),
    trusted: isTrustedSpotter(r.username),
    lat: r.p.lat,
    lon: r.p.lon,
    heading: r.p.heading,
    speedKmh: r.p.speedKmh,
    ageSec: Math.max(0, Math.round((now - r.p.updatedAt) / 1000)),
    mine: r.p.userId === viewerId,
    stream: parseStream(r.p.stream),
  }));
}
