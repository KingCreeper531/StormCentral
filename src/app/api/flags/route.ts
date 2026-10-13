import { getSessionUser } from "@/lib/auth/session";
import { firstIssue, flagSchema } from "@/lib/community";
import { createFlag } from "@/lib/server/moderation-repo";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";

const noStore = { "Cache-Control": "private, no-store" };

/** Report a report, comment or account to the moderators. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const blocked = suspended(user);
  if (blocked) return blocked;
  const rl = rateLimit(`flag:${user.id}`, 20, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const parsed = flagSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const r = await createFlag(user.id, parsed.data);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: noStore });
  return Response.json({ ok: true }, { status: 201, headers: noStore });
}
