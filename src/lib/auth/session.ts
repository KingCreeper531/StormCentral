import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db/client";
import { avatarUrl } from "../community";
import { sessions, users } from "../db/schema";

/**
 * Opaque bearer-token sessions (the approach Lucia's authors now recommend
 * hand-rolling): the cookie holds 256 random bits; the DB stores only its
 * SHA-256, so a database leak can't be replayed as live sessions.
 * Sessions slide: any use in the second half of their life extends them.
 */
const SESSION_DAYS = 30;
const DAY = 86_400_000;
// Secure (HTTPS-only) in production. The desktop app's server listens on plain
// http://127.0.0.1 and opts out with SESSION_COOKIE_SECURE=false.
const secureCookie = process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "false";
// `__Host-` binds the cookie to this exact origin, HTTPS-only, path=/.
export const SESSION_COOKIE = secureCookie ? "__Host-sc_session" : "sc_session";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  avatarUrl: string | null;
  /** Listed in MODERATORS or made a moderator in the app, and not suspended: sees the moderation queue and can act on it. */
  moderator: boolean;
  /** Set while a moderator has suspended the account. */
  suspendedUntil: number | null;
}

const usernames = (value: string | undefined) => (value ?? "").split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);

/** Moderators are named by username in the MODERATORS environment variable (comma-separated). */
export function isModerator(username: string) {
  return usernames(process.env.MODERATORS).includes(username.toLowerCase());
}

/** The project's official account, badged as Developer unless DEVELOPERS says otherwise. */
const DEFAULT_DEVELOPERS = "StormCentral_Official";

/** Accounts shown with the Developer badge: DEVELOPERS (comma-separated usernames). */
export function isDeveloper(username: string) {
  return usernames(process.env.DEVELOPERS ?? DEFAULT_DEVELOPERS).includes(username.toLowerCase());
}

/** Who can draw on the live stream (components/draw): moderators and the app's developers, unless suspended. */
export function isPresenter(user: Pick<SessionUser, "username" | "moderator" | "suspendedUntil">, now = Date.now()) {
  if (user.suspendedUntil != null && user.suspendedUntil > now) return false;
  return user.moderator || isDeveloper(user.username);
}

/** Spotters given the Trusted Spotter rank by hand, whatever their confirmations. */
const GRANTED_TRUSTED_SPOTTERS = "zenitsu132,zenwx";

/**
 * Accounts that rank at least Trusted Spotter (badge and profile)
 * however few confirmations they have: the ones granted here, plus
 * TRUSTED_SPOTTERS (comma-separated usernames).
 */
export function isTrustedSpotter(username: string) {
  return usernames(`${GRANTED_TRUSTED_SPOTTERS},${process.env.TRUSTED_SPOTTERS ?? ""}`).includes(username.toLowerCase());
}

/** Spotters who may issue WarnGen warnings, named in WARNGEN_ISSUERS (comma-separated); moderators give the role in the app too. */
export function isWarnGenIssuer(username: string) {
  return usernames(process.env.WARNGEN_ISSUERS).includes(username.toLowerCase());
}

/**
 * Roles come with these usernames, so nobody can sign up as one: not on a fresh
 * database, and not after the account that had it is deleted.
 */
export const isReservedUsername = (username: string) => isModerator(username) || isDeveloper(username) || isWarnGenIssuer(username) || isTrustedSpotter(username);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function setCookie(token: string, expiresAt: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * DAY;
  const db = await getDb();
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, createdAt: now });
  await setCookie(token, expiresAt);
  // Opportunistic cleanup of this user's expired sessions.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now)));
}

/**
 * Resolve the current user. Pass `{ refresh: true }` from route handlers
 * (which may set cookies) to slide the expiry; Server Components can't.
 */
export async function getSessionUser(opts: { refresh?: boolean } = {}): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  const db = await getDb();
  const id = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarHue: users.avatarHue,
      avatarMediaId: users.avatarMediaId,
      suspendedUntil: users.suspendedUntil,
      // Made a moderator in the app (lib/server/roles-repo.ts), read fresh each time so taking it away works at once.
      grantedModerator: sql<number>`EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = ${users.id} AND r.role = 'moderator')`,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (opts.refresh && row.expiresAt - now < (SESSION_DAYS / 2) * DAY) {
    const expiresAt = now + SESSION_DAYS * DAY;
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    await setCookie(token, expiresAt);
  }
  const suspendedUntil = row.suspendedUntil != null && row.suspendedUntil > now ? row.suspendedUntil : null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarHue: row.avatarHue,
    avatarUrl: avatarUrl(row.avatarMediaId),
    // A suspended moderator has no moderator powers (and so can't lift their own suspension).
    moderator: (isModerator(row.username) || Number(row.grantedModerator) === 1) && suspendedUntil == null,
    suspendedUntil,
  };
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await (await getDb()).delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}
