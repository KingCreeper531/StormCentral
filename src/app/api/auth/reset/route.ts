import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { consumeResetToken, endAllSessions } from "@/lib/auth/reset";
import { createSession } from "@/lib/auth/session";
import { firstIssue, resetSchema } from "@/lib/community";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { forbidden, sameOrigin, tooMany } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

/** Sets a new password from a reset link, signs out other devices and signs in here. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const ip = rateLimit(`reset-ip:${clientIp(req)}`, 10, 15 * 60_000);
  if (!ip.ok) return tooMany(ip.retryAfterSec);
  const parsed = resetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const userId = await consumeResetToken(parsed.data.token);
  if (!userId) return Response.json({ error: "This reset link has expired or was already used. Ask for a new one." }, { status: 400 });

  const db = await getDb();
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, userId));
  await endAllSessions(userId);
  await createSession(userId);
  const [user] = await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  return Response.json({ user });
}
