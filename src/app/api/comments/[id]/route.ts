import { getSessionUser } from "@/lib/auth/session";
import { deleteComment, getComment } from "@/lib/server/community-repo";
import { forbidden, sameOrigin, unauthorized } from "@/lib/server/guard";

/** Delete a comment: its author or a moderator. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const comment = await getComment(id);
  if (!comment) return Response.json({ error: "Not found" }, { status: 404 });
  if (comment.userId !== user.id && !user.moderator) return forbidden("You can only delete your own comments");
  await deleteComment(id);
  return Response.json({ ok: true });
}
