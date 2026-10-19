import { getSessionUser } from "@/lib/auth/session";
import { firstIssue } from "@/lib/community";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";
import { cancelWarning, getWarning, updateWarning } from "@/lib/server/warngen-repo";
import { draftProblems, updateSchema } from "@/lib/warngen/schema";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * PATCH /api/spotter-warnings/:id {action: "update", …fields} | {action: "cancel"}.
 * Only the issuer updates; the issuer or a moderator cancels.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser({ refresh: true });
  if (!user) return unauthorized();
  const blocked = suspended(user);
  if (blocked) return blocked;
  const rl = rateLimit(`warngen-edit:${user.id}`, 30, 15 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const { id } = await ctx.params;
  const current = await getWarning(id, user.id);
  if (!current) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  if (current.status !== "active") return badRequest(current.status === "cancelled" ? "This warning was already cancelled" : "This warning has expired");

  const raw: unknown = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));

  if (parsed.data.action === "cancel") {
    if (!current.mine && !user.moderator) return forbidden("Only the spotter who issued it (or a moderator) can cancel this warning");
    await cancelWarning(id);
  } else {
    if (!current.mine) return forbidden("Only the spotter who issued it can update this warning");
    const problems = draftProblems({ ...parsed.data, kind: current.kind });
    if (problems.length) return badRequest(problems[0]!);
    await updateWarning(id, parsed.data);
  }
  return Response.json({ warning: await getWarning(id, user.id) }, { headers: noStore });
}
