import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { passwordResets, sessions } from "../db/schema";

/** Reset links work once, for 30 minutes. */
export const RESET_MINUTES = 30;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** New single-use token for `userId`; earlier unused ones stop working. */
export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const db = await getDb();
  await db.delete(passwordResets).where(eq(passwordResets.userId, userId));
  await db.insert(passwordResets).values({ id: hash(token), userId, expiresAt: now + RESET_MINUTES * 60_000, createdAt: now });
  return token;
}

/** The user a valid token belongs to (and uses it up), or null. */
export async function consumeResetToken(token: string): Promise<string | null> {
  if (!token || token.length > 128) return null;
  const db = await getDb();
  const now = Date.now();
  const [row] = await db
    .select({ userId: passwordResets.userId })
    .from(passwordResets)
    .where(and(eq(passwordResets.id, hash(token)), gt(passwordResets.expiresAt, now)))
    .limit(1);
  await db.delete(passwordResets).where(lt(passwordResets.expiresAt, now));
  if (!row) return null;
  await db.delete(passwordResets).where(eq(passwordResets.userId, row.userId));
  return row.userId;
}

/** Sign the user out everywhere (after a password change or reset). */
export async function endAllSessions(userId: string) {
  await (await getDb()).delete(sessions).where(eq(sessions.userId, userId));
}
