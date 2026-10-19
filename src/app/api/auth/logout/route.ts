import { destroySession, getSessionUser } from "@/lib/auth/session";
import { stopSharing } from "@/lib/server/chaser-repo";
import { forbidden, sameOrigin } from "@/lib/server/guard";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  // Signing out stops sharing a live chaser position.
  const user = await getSessionUser();
  if (user) await stopSharing(user.id);
  await destroySession();
  return Response.json({ ok: true });
}
