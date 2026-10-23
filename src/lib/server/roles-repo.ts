import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { isDeveloper, isModerator, isTrustedSpotter, isWarnGenIssuer, type SessionUser } from "../auth/session";
import { GRANTABLE_ROLES, type GrantableRole, type GrantedRoleDto, type RoleInfoDto } from "../community";
import { getDb } from "../db/client";
import { userRoles, users } from "../db/schema";

/**
 * Roles moderators give in the app (user_roles), next to the built-in ones
 * in the code and environment (auth/session.ts). Badges read a cached set of
 * the accounts given Trusted Spotter, refreshed every CACHE_MS and at once on
 * this server when a role changes; moderator powers are read fresh with each
 * session (auth/session.ts), so taking them away works on the next request.
 */

const CACHE_MS = 30_000;
let cache: { at: number; trusted: Promise<Set<string>> } | null = null;

const isRole = (r: string): r is GrantableRole => (GRANTABLE_ROLES as readonly string[]).includes(r);

/** Usernames (lower case) given Trusted Spotter in the app. */
export function grantedTrusted(now = Date.now()): Promise<Set<string>> {
  if (!cache || now - cache.at > CACHE_MS) {
    const trusted = (async () => {
      const db = await getDb();
      const rows = await db.select({ username: users.username }).from(userRoles).innerJoin(users, eq(userRoles.userId, users.id)).where(eq(userRoles.role, "trusted"));
      return new Set(rows.map((r) => r.username.toLowerCase()));
    })();
    cache = { at: now, trusted };
    // A failed read isn't kept: the next caller tries again.
    trusted.catch(() => {
      if (cache?.trusted === trusted) cache = null;
    });
  }
  return cache.trusted;
}

/** Trusted Spotter from the code or environment, or given in the app. */
export const isTrusted = (username: string, granted: ReadonlySet<string>) => isTrustedSpotter(username) || granted.has(username.toLowerCase());

/** Whether `actor` may give or take away `role`: Trusted Spotter, any moderator; WarnGen and Moderator, only those named in MODERATORS. */
export function canChangeRole(actor: Pick<SessionUser, "username" | "moderator">, role: GrantableRole): boolean {
  if (!actor.moderator) return false;
  return role === "trusted" || isModerator(actor.username);
}

/** The roles given to one account in the app. */
export async function rolesOf(userId: string): Promise<Set<GrantableRole>> {
  const db = await getDb();
  const rows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
  return new Set(rows.map((r) => r.role).filter(isRole));
}

export async function setRole(userId: string, role: GrantableRole, on: boolean, grantedBy: string) {
  const db = await getDb();
  if (on) await db.insert(userRoles).values({ userId, role, grantedBy, grantedAt: Date.now() }).onConflictDoNothing();
  else await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
  cache = null;
}

const granter = alias(users, "granter");

/** One account's roles for the Roles panel, or null when there's no such account. */
export async function roleInfo(username: string, viewer: Pick<SessionUser, "id" | "username" | "moderator">): Promise<RoleInfoDto | null> {
  const db = await getDb();
  const [user] = await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(eq(users.username, username));
  if (!user) return null;
  const rows = await db
    .select({ role: userRoles.role, at: userRoles.grantedAt, by: granter.username })
    .from(userRoles)
    .leftJoin(granter, eq(userRoles.grantedBy, granter.id))
    .where(eq(userRoles.userId, user.id));
  const self = user.id === viewer.id;
  return {
    username: user.username,
    displayName: user.displayName,
    builtIn: { moderator: isModerator(user.username), warngen: isWarnGenIssuer(user.username), trusted: isTrustedSpotter(user.username), developer: isDeveloper(user.username) },
    granted: rows.filter((r): r is typeof r & { role: GrantableRole } => isRole(r.role)).map((r) => ({ role: r.role, by: r.by, at: r.at })),
    // Nobody changes their own roles.
    canChange: { trusted: !self && canChangeRole(viewer, "trusted"), warngen: !self && canChangeRole(viewer, "warngen"), moderator: !self && canChangeRole(viewer, "moderator") },
  };
}

/** Every role given in the app, newest first. */
export async function listGranted(): Promise<GrantedRoleDto[]> {
  const db = await getDb();
  const rows = await db
    .select({ username: users.username, displayName: users.displayName, role: userRoles.role, at: userRoles.grantedAt, by: granter.username })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .leftJoin(granter, eq(userRoles.grantedBy, granter.id))
    .orderBy(desc(userRoles.grantedAt))
    .limit(500);
  return rows.filter((r): r is typeof r & { role: GrantableRole } => isRole(r.role));
}
