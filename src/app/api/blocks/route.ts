import { getSessionUser } from "@/lib/auth/session";
import { blockSchema, firstIssue } from "@/lib/community";
import { block, findUserId, listBlocked, unblock } from "@/lib/server/moderation-repo";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";

const noStore = { "Cache-Control": "private, no-store" };

/** The accounts the signed-in user has blocked. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return Response.json({ blocked: await listBlocked(user.id) }, { headers: noStore });
}

async function target(req: Request) {
  const parsed = blockSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return { error: badRequest(firstIssue(parsed.error)) };
  const id = await findUserId(parsed.data.username);
  if (!id) return { error: Response.json({ error: "That account doesn't exist" }, { status: 404, headers: noStore }) };
  return { id };
}

/** Block someone: neither of you sees the other's reports or comments, and you can't interact. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const rl = rateLimit(`block:${user.id}`, 30, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const t = await target(req);
  if (t.error) return t.error;
  if (t.id === user.id) return badRequest("You can't block yourself");
  await block(user.id, t.id);
  return Response.json({ ok: true }, { headers: noStore });
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const t = await target(req);
  if (t.error) return t.error;
  await unblock(user.id, t.id);
  return Response.json({ ok: true }, { headers: noStore });
}
