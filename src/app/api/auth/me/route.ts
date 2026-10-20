import { getSessionUser, isPresenter } from "@/lib/auth/session";
import { mpingEnabled } from "@/lib/server/mping";

/**
 * The signed-in user, whether reports can be sent on to mPING (the server
 * has a token), and whether they can draw on the live stream.
 */
export async function GET() {
  const user = await getSessionUser({ refresh: true });
  return Response.json({ user, mping: mpingEnabled(), presenter: !!user && isPresenter(user) }, { headers: { "Cache-Control": "private, no-store" } });
}
