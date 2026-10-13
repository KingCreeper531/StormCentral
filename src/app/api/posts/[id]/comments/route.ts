import { getSessionUser } from "@/lib/auth/session";
import { commentSchema, firstIssue } from "@/lib/community";
import { addComment, getPostOwner, listComments } from "@/lib/server/community-repo";
import { blockedBetween } from "@/lib/server/moderation-repo";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getSessionUser();
  return Response.json({ comments: await listComments(id, viewer?.id ?? null) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const blocked = suspended(user);
  if (blocked) return blocked;
  const rl = rateLimit(`comment:${user.id}`, 20, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const { id } = await ctx.params;
  const owner = await getPostOwner(id);
  if (!owner) return Response.json({ error: "Not found" }, { status: 404 });
  if (await blockedBetween(user.id, owner.userId)) return forbidden("You can't comment on this report");
  const parsed = commentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  return Response.json({ id: await addComment(id, user.id, parsed.data.body) }, { status: 201 });
}
