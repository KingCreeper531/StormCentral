import { getSessionUser } from "@/lib/auth/session";
import { getPostOwner, toggleVerification } from "@/lib/server/community-repo";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";

/** Toggle "I can confirm this" — the crowd-verification signal behind reputation. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const rl = rateLimit(`verify:${user.id}`, 60, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const { id } = await ctx.params;
  const owner = await getPostOwner(id);
  if (!owner) return Response.json({ error: "Not found" }, { status: 404 });
  if (owner.userId === user.id) return forbidden("You can't verify your own report");
  return Response.json(await toggleVerification(id, user.id));
}
