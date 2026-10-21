import { getSessionUser } from "@/lib/auth/session";
import { commentSchema, firstIssue } from "@/lib/community";
import { addComment, getVisiblePost, listComments } from "@/lib/server/community-repo";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";

const noStore = { "Cache-Control": "private, no-store" };

/** A report's thread, for whoever can see the report (hidden, suspended or blocked-either-way ones are a 404, as in the feeds). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getSessionUser();
  if (!(await getVisiblePost(id, viewer?.id ?? null, !!viewer?.moderator))) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  return Response.json({ comments: await listComments(id, viewer?.id ?? null) }, { headers: noStore });
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
  if (!(await getVisiblePost(id, user.id, user.moderator))) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = commentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  return Response.json({ id: await addComment(id, user.id, parsed.data.body) }, { status: 201 });
}
