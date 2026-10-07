import { eq, or } from "drizzle-orm";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { firstIssue, loginSchema } from "@/lib/community";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { forbidden, sameOrigin, tooMany } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { identifier, password } = parsed.data;

  // Throttle per IP and per account to blunt both spraying and stuffing.
  const ip = rateLimit(`login-ip:${clientIp(req)}`, 20, 15 * 60_000);
  const acct = rateLimit(`login-acct:${identifier.toLowerCase()}`, 8, 15 * 60_000);
  if (!ip.ok) return tooMany(ip.retryAfterSec);
  if (!acct.ok) return tooMany(acct.retryAfterSec);

  const db = await getDb();
  const [user] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, passwordHash: users.passwordHash })
    .from(users)
    .where(or(eq(users.username, identifier), eq(users.email, identifier.toLowerCase())))
    .limit(1);

  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
  if (!user || !ok) return Response.json({ error: "Incorrect username or password" }, { status: 401 });

  await createSession(user.id);
  return Response.json({ user: { id: user.id, username: user.username, displayName: user.displayName } });
}
