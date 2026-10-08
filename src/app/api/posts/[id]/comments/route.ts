import { getSessionUser } from "@/lib/auth/session";
import { commentSchema, firstIssue } from "@/lib/community";
import { addComment, getPostOwner, listComments } from "@/lib/server/community-repo";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
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
  const rl = rateLimit(`comment:${user.id}`, 20, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const { id } = await ctx.params;
  if (!(await getPostOwner(id))) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = commentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  return Response.json({ id: await addComment(id, user.id, parsed.data.body) }, { status: 201 });
}
