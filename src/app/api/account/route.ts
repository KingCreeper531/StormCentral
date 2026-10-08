import { eq, inArray, or } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth/password";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { deleteAccountSchema, firstIssue, profileSchema } from "@/lib/community";
import { getDb } from "@/lib/db/client";
import { comments, media, passwordResets, posts, sessions, users, verifications } from "@/lib/db/schema";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";

const noStore = { "Cache-Control": "no-store" };

/** Update display name and bio. */
export async function PATCH(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser({ refresh: true });
  if (!user) return unauthorized();
  const parsed = profileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400, headers: noStore });
  const db = await getDb();
  await db
    .update(users)
    .set({ displayName: parsed.data.displayName, bio: parsed.data.bio ? parsed.data.bio : null })
    .where(eq(users.id, user.id));
  return Response.json({ ok: true }, { headers: noStore });
}

/** Read the signed-in user's editable profile. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const db = await getDb();
  const [row] = await db.select({ displayName: users.displayName, bio: users.bio, email: users.email }).from(users).where(eq(users.id, user.id));
  return Response.json({ ...row, username: user.username, avatarUrl: user.avatarUrl }, { headers: noStore });
}

/** Delete the account and everything it posted. Needs the password. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const rl = rateLimit(`delete-account:${user.id}`, 5, 15 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const parsed = deleteAccountSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400, headers: noStore });

  const db = await getDb();
  const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(parsed.data.password, row.hash))) {
    return Response.json({ error: "That password isn't right" }, { status: 400, headers: noStore });
  }

  // Explicit cascade: libSQL's pool doesn't guarantee PRAGMA foreign_keys.
  const own = (await db.select({ id: posts.id }).from(posts).where(eq(posts.userId, user.id))).map((p) => p.id);
  const onOwnPosts = own.length ? [inArray(verifications.postId, own)] : [];
  const commentsOnOwn = own.length ? [inArray(comments.postId, own)] : [];
  await db.batch([
    db.delete(verifications).where(or(eq(verifications.userId, user.id), ...onOwnPosts)),
    db.delete(comments).where(or(eq(comments.userId, user.id), ...commentsOnOwn)),
    db.delete(posts).where(eq(posts.userId, user.id)),
    db.delete(media).where(eq(media.userId, user.id)),
    db.delete(passwordResets).where(eq(passwordResets.userId, user.id)),
    db.delete(sessions).where(eq(sessions.userId, user.id)),
    db.delete(users).where(eq(users.id, user.id)),
  ]);
  await destroySession();
  return Response.json({ ok: true }, { headers: noStore });
}
