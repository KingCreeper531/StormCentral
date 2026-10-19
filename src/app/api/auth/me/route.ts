import { getSessionUser } from "@/lib/auth/session";
import { mpingEnabled } from "@/lib/server/mping";

/** The signed-in user, and whether reports can be sent on to mPING (the server has a token). */
export async function GET() {
  const user = await getSessionUser({ refresh: true });
  return Response.json({ user, mping: mpingEnabled() }, { headers: { "Cache-Control": "private, no-store" } });
}
