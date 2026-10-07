import { getSessionUser } from "@/lib/auth/session";
import { deletePost, getPostOwner } from "@/lib/server/community-repo";
import { forbidden, sameOrigin, unauthorized } from "@/lib/server/guard";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const owner = await getPostOwner(id);
  if (!owner) return Response.json({ error: "Not found" }, { status: 404 });
  if (owner.userId !== user.id) return forbidden("You can only delete your own reports");
  await deletePost(id, owner.mediaId);
  return Response.json({ ok: true });
}
