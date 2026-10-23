import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, isNull, lte, max, or, sql } from "drizzle-orm";
import { isDeveloper, isWarnGenIssuer, type SessionUser } from "../auth/session";
import { grantedTrusted, isTrusted, rolesOf } from "./roles-repo";
import { getDb } from "../db/client";
import { spotterWarnings, users } from "../db/schema";
import { ringBounds, type Ring } from "../warngen/geometry";
import { isWarnKind, WARN_BASES, WARN_THREATS, type WarnBasis, type WarnThreat } from "../warngen/products";
import type { IssueRequest, SpotterWarningDto, UpdateRequest } from "../warngen/schema";
import { notBlocked, reputationSql as reputation } from "./community-repo";

/** Ended warnings stay listed (greyed out) this long. */
const RECENT_MS = 30 * 60_000;
/** Active warnings one spotter may have at once. */
export const MAX_ACTIVE_PER_USER = 6;

/** WARNGEN_MIN_REPUTATION: confirmations that open WarnGen without the role (0 opens it to every member); unset, only the role does. */
export function issueReputation(): number | null {
  const raw = process.env.WARNGEN_MIN_REPUTATION;
  const v = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isInteger(v) && v >= 0 ? v : null;
}

export const NEEDS_WARNGEN_ROLE = "WarnGen is for spotters a moderator has given the WarnGen role. Ask a moderator if you'd like it.";

/** Whether `user` may issue warnings, and if not, why. */
export async function issuePermission(user: SessionUser): Promise<{ ok: boolean; reason: string | null }> {
  if (user.suspendedUntil != null) return { ok: false, reason: "Your account is suspended." };
  if (user.moderator || isDeveloper(user.username) || isWarnGenIssuer(user.username)) return { ok: true, reason: null };
  if ((await rolesOf(user.id)).has("warngen")) return { ok: true, reason: null };
  const need = issueReputation();
  if (need == null) return { ok: false, reason: NEEDS_WARNGEN_ROLE };
  if (need === 0) return { ok: true, reason: null };
  const db = await getDb();
  const [row] = await db.select({ rep: reputation }).from(users).where(eq(users.id, user.id));
  const rep = Number(row?.rep ?? 0);
  return rep >= need
    ? { ok: true, reason: null }
    : { ok: false, reason: `WarnGen opens at ${need} confirmations of your reports by other spotters (you have ${rep}), or with the WarnGen role from a moderator.` };
}

function parseJson<T>(raw: string | null, ok: (v: unknown) => v is T): T | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return ok(v) ? v : null;
  } catch {
    return null;
  }
}

const isRing = (v: unknown): v is Ring => Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"));
const isStorm = (v: unknown): v is { lat: number; lon: number; t: number } => !!v && typeof v === "object" && ["lat", "lon", "t"].every((k) => typeof (v as Record<string, unknown>)[k] === "number");
const isMotion = (v: unknown): v is { headingDeg: number; speedKt: number } => !!v && typeof v === "object" && ["headingDeg", "speedKt"].every((k) => typeof (v as Record<string, unknown>)[k] === "number");
const isNames = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

type Row = typeof spotterWarnings.$inferSelect & { username: string; displayName: string; reputation: number };

function toDto(r: Row, viewerId: string, now: number, trusted: ReadonlySet<string>): SpotterWarningDto {
  return {
    id: r.id,
    number: r.number,
    kind: isWarnKind(r.kind) ? r.kind : "SPS",
    status: r.cancelledAt ? "cancelled" : r.expiresAt <= now ? "expired" : "active",
    polygon: parseJson(r.polygon, isRing) ?? [],
    issuedAt: r.issuedAt,
    updatedAt: r.updatedAt,
    expiresAt: r.expiresAt,
    cancelledAt: r.cancelledAt,
    revision: r.revision,
    storm: parseJson(r.storm, isStorm),
    motion: parseJson(r.motion, isMotion),
    basis: (WARN_BASES as readonly string[]).includes(r.basis) ? (r.basis as WarnBasis) : "radar",
    hail: r.hail,
    wind: r.wind,
    tornadoPossible: r.tornadoPossible === 1,
    threat: (WARN_THREATS as readonly string[]).includes(r.threat) ? (r.threat as WarnThreat) : "base",
    notes: r.notes,
    place: r.place,
    locations: parseJson(r.locations, isNames) ?? [],
    issuer: {
      username: r.username,
      displayName: r.displayName,
      reputation: Number(r.reputation),
      developer: isDeveloper(r.username),
      trusted: isTrusted(r.username, trusted),
    },
    mine: r.userId === viewerId,
  };
}

const selection = {
  w: spotterWarnings,
  username: users.username,
  displayName: users.displayName,
  reputation: reputation,
};

/** Active warnings plus those that ended in the last half hour, newest first. */
export async function listWarnings(viewerId: string, now = Date.now()): Promise<SpotterWarningDto[]> {
  const db = await getDb();
  const rows = await db
    .select(selection)
    .from(spotterWarnings)
    .innerJoin(users, eq(users.id, spotterWarnings.userId))
    .where(
      and(
        gt(spotterWarnings.expiresAt, now - RECENT_MS),
        or(isNull(spotterWarnings.cancelledAt), gt(spotterWarnings.cancelledAt, now - RECENT_MS)),
        // Suspended accounts' warnings are hidden from everyone but their author.
        or(eq(spotterWarnings.userId, viewerId), isNull(users.suspendedUntil), lte(users.suspendedUntil, now)),
        notBlocked(viewerId, sql`${spotterWarnings.userId}`),
      ),
    )
    .orderBy(desc(spotterWarnings.issuedAt), desc(spotterWarnings.number))
    .limit(200);
  const trusted = await grantedTrusted();
  return rows.map(({ w, ...u }) => toDto({ ...w, ...u }, viewerId, now, trusted));
}

export async function getWarning(id: string, viewerId: string, now = Date.now()): Promise<SpotterWarningDto | null> {
  const db = await getDb();
  const [row] = await db.select(selection).from(spotterWarnings).innerJoin(users, eq(users.id, spotterWarnings.userId)).where(eq(spotterWarnings.id, id)).limit(1);
  return row ? toDto({ ...row.w, username: row.username, displayName: row.displayName, reputation: row.reputation }, viewerId, now, await grantedTrusted()) : null;
}

export async function activeCount(userId: string, now = Date.now()): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(spotterWarnings)
    .where(and(eq(spotterWarnings.userId, userId), gt(spotterWarnings.expiresAt, now), isNull(spotterWarnings.cancelledAt)));
  return Number(row?.n ?? 0);
}

function fieldsOf(d: Omit<IssueRequest, "kind">, now: number) {
  const [west, south, east, north] = ringBounds(d.polygon);
  return {
    polygon: JSON.stringify(d.polygon),
    west,
    south,
    east,
    north,
    expiresAt: now + d.minutes * 60_000,
    storm: d.storm ? JSON.stringify(d.storm) : null,
    motion: d.motion ? JSON.stringify(d.motion) : null,
    basis: d.basis,
    hail: d.hail,
    wind: d.wind,
    tornadoPossible: d.tornadoPossible ? 1 : 0,
    threat: d.threat,
    notes: d.notes || null,
    place: d.place || null,
    locations: JSON.stringify(d.locations),
  };
}

/** Issue a warning; numbers run per calendar year (UTC). */
export async function createWarning(userId: string, d: IssueRequest, now = Date.now()): Promise<string> {
  const db = await getDb();
  const year = new Date(now).getUTCFullYear();
  const id = randomUUID();
  // The (year, number) unique index settles a race between two issuers; retry with the next number.
  for (let attempt = 0; ; attempt++) {
    const [row] = await db.select({ n: max(spotterWarnings.number) }).from(spotterWarnings).where(eq(spotterWarnings.year, year));
    const number = Number(row?.n ?? 0) + 1;
    try {
      await db.insert(spotterWarnings).values({ id, userId, year, number, kind: d.kind, issuedAt: now, updatedAt: now, revision: 0, ...fieldsOf(d, now) });
      return id;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}

/** Continue a warning with a new polygon, duration or tags. */
export async function updateWarning(id: string, d: Extract<UpdateRequest, { action: "update" }>, now = Date.now()) {
  const db = await getDb();
  await db
    .update(spotterWarnings)
    .set({ ...fieldsOf(d, now), updatedAt: now, revision: sql`${spotterWarnings.revision} + 1` })
    .where(eq(spotterWarnings.id, id));
}

export async function cancelWarning(id: string, now = Date.now()) {
  const db = await getDb();
  await db.update(spotterWarnings).set({ cancelledAt: now, updatedAt: now }).where(eq(spotterWarnings.id, id));
}
