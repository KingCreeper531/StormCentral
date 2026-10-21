import { getSessionUser } from "@/lib/auth/session";
import { getVisiblePost, toggleVerification } from "@/lib/server/community-repo";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";

/** Toggle "I can confirm this" — the crowd-verification signal behind reputation. Only on reports the person can see. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const blocked = suspended(user);
  if (blocked) return blocked;
  const rl = rateLimit(`verify:${user.id}`, 60, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const { id } = await ctx.params;
  const post = await getVisiblePost(id, user.id, user.moderator);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  if (post.userId === user.id) return forbidden("You can't verify your own report");
  return Response.json(await toggleVerification(id, user.id));
}
