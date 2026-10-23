import { getSessionUser } from "@/lib/auth/session";
import { firstIssue, GRANTABLE_ROLES, roleChangeSchema, type GrantedListDto } from "@/lib/community";
import { findUserId } from "@/lib/server/moderation-repo";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { badRequest } from "@/lib/server/respond";
import { canChangeRole, listGranted, roleInfo, setRole } from "@/lib/server/roles-repo";
import { rateLimit } from "@/lib/server/rate-limit";

const noStore = { "Cache-Control": "private, no-store" };

async function moderator() {
  const user = await getSessionUser();
  if (!user) return { error: unauthorized() };
  const blocked = suspended(user);
  if (blocked) return { error: blocked };
  if (!user.moderator) return { error: forbidden("Moderators only") };
  return { user };
}

/** ?username=… gives that account's roles; without it, every role given in the app. Moderators only. */
export async function GET(req: Request) {
  const m = await moderator();
  if (m.error) return m.error;
  const username = new URL(req.url).searchParams.get("username")?.trim();
  if (!username) {
    const body: GrantedListDto = {
      granted: await listGranted(),
      canChange: Object.fromEntries(GRANTABLE_ROLES.map((role) => [role, canChangeRole(m.user, role)])) as GrantedListDto["canChange"],
      you: m.user.username,
    };
    return Response.json(body, { headers: noStore });
  }
  const info = await roleInfo(username.slice(0, 24), m.user);
  if (!info) return Response.json({ error: "No account with that username" }, { status: 404, headers: noStore });
  return Response.json(info, { headers: noStore });
}

/** Give or take away a role: Trusted Spotter (any moderator), WarnGen or Moderator (only those named in MODERATORS); never your own. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const m = await moderator();
  if (m.error) return m.error;
  const rl = rateLimit(`roles:${m.user.id}`, 30, 15 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const parsed = roleChangeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { username, role, on } = parsed.data;
  if (!canChangeRole(m.user, role)) return forbidden("Only the site's own moderators can give or take away that role");
  const id = await findUserId(username);
  if (!id) return Response.json({ error: "No account with that username" }, { status: 404, headers: noStore });
  if (id === m.user.id) return badRequest("You can't change your own roles");
  await setRole(id, role, on, m.user.id);
  return Response.json(await roleInfo(username, m.user), { headers: noStore });
}
