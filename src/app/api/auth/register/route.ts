import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { firstIssue, registerSchema } from "@/lib/community";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { forbidden, sameOrigin, tooMany } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const rl = rateLimit(`register:${clientIp(req)}`, 5, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { username, email, password, displayName } = parsed.data;

  const db = await getDb();
  const clash = await db
    .select({ username: users.username, email: users.email })
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, email)))
    .limit(1);
  if (clash.length) {
    const field = clash[0]!.username.toLowerCase() === username.toLowerCase() ? "username" : "email";
    return Response.json({ error: `That ${field} is already registered` }, { status: 409 });
  }

  const id = randomUUID();
  try {
    await db.insert(users).values({
      id,
      username,
      email,
      passwordHash: await hashPassword(password),
      displayName: displayName || username,
      avatarHue: Math.floor(Math.random() * 360),
      createdAt: Date.now(),
    });
  } catch {
    // Unique-constraint race with a concurrent registration.
    return Response.json({ error: "That username or email is already registered" }, { status: 409 });
  }
  await createSession(id);
  return Response.json({ user: { id, username, displayName: displayName || username } }, { status: 201 });
}
