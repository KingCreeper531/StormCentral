import { getSessionUser } from "@/lib/auth/session";
import { firstIssue } from "@/lib/community";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";
import { activeCount, createWarning, getWarning, issuePermission, listWarnings, MAX_ACTIVE_PER_USER } from "@/lib/server/warngen-repo";
import { issueSchema, type SpotterWarningsResponse } from "@/lib/warngen/schema";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * GET /api/spotter-warnings: active spotter-network warnings (and those that
 * ended in the last half hour). Members only: these are unofficial warnings
 * for the spotter network, not for the public.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const [warnings, perm] = await Promise.all([listWarnings(user.id), issuePermission(user)]);
  const body: SpotterWarningsResponse = { warnings, canIssue: perm.ok, reason: perm.reason, moderator: user.moderator };
  return Response.json(body, { headers: noStore });
}

/** POST /api/spotter-warnings (JSON, lib/warngen/schema `issueSchema`): issue a warning from WarnGen. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser({ refresh: true });
  if (!user) return unauthorized();
  const blocked = suspended(user);
  if (blocked) return blocked;
  const perm = await issuePermission(user);
  if (!perm.ok) return forbidden(perm.reason ?? "You can't issue spotter warnings yet");
  const rl = rateLimit(`warngen:${user.id}`, 8, 15 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const raw: unknown = await req.json().catch(() => null);
  const parsed = issueSchema.safeParse(raw);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  if ((await activeCount(user.id)) >= MAX_ACTIVE_PER_USER) return badRequest(`You already have ${MAX_ACTIVE_PER_USER} active warnings. Cancel or let one expire first.`);

  const id = await createWarning(user.id, parsed.data);
  return Response.json({ warning: await getWarning(id, user.id) }, { status: 201, headers: noStore });
}
