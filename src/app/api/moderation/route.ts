import { getSessionUser } from "@/lib/auth/session";
import { firstIssue, moderationActionSchema } from "@/lib/community";
import { findUserId, keepContent, moderationQueue, removeContent, suspendUser, unsuspendUser } from "@/lib/server/moderation-repo";
import { forbidden, sameOrigin, unauthorized } from "@/lib/server/guard";
import { badRequest } from "@/lib/server/respond";

const noStore = { "Cache-Control": "private, no-store" };
const notFound = () => Response.json({ error: "That no longer exists" }, { status: 404, headers: noStore });

/** The moderation queue: everything with open flags. Moderators only. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!user.moderator) return forbidden("Moderators only");
  return Response.json({ items: await moderationQueue() }, { headers: noStore });
}

/** Act on the queue: keep, remove, suspend or unsuspend. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!user.moderator) return forbidden("Moderators only");
  const parsed = moderationActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const a = parsed.data;

  if (a.action === "keep") await keepContent(a.type, a.id);
  else if (a.action === "remove") {
    if (!(await removeContent(a.type, a.id))) return notFound();
  } else {
    const id = await findUserId(a.username);
    if (!id) return notFound();
    if (a.action === "suspend") {
      if (id === user.id) return badRequest("You can't suspend yourself");
      return Response.json({ ok: true, suspendedUntil: await suspendUser(id, a.days) }, { headers: noStore });
    }
    await unsuspendUser(id);
  }
  return Response.json({ ok: true }, { headers: noStore });
}
