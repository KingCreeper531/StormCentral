import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { endAllSessions } from "@/lib/auth/reset";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { changePasswordSchema, firstIssue } from "@/lib/community";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";

/** Change password while signed in. Other devices are signed out. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const me = await getSessionUser();
  if (!me) return unauthorized();
  const limit = rateLimit(`password:${me.id}`, 8, 15 * 60_000);
  if (!limit.ok) return tooMany(limit.retryAfterSec);
  const parsed = changePasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const db = await getDb();
  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1);
  if (!row || !(await verifyPassword(parsed.data.current, row.passwordHash))) {
    return Response.json({ error: "Your current password isn't right" }, { status: 400 });
  }
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, me.id));
  await endAllSessions(me.id);
  await createSession(me.id);
  return Response.json({ ok: true });
}
