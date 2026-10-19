import { after } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/server/guard";
import { listActivity } from "@/lib/server/community-repo";
import { maybeSyncNwsConfirmations } from "@/lib/server/nws-sync";

const noStore = { "Cache-Control": "private, no-store" };
/** Never reach back further than this, whatever `since` says. */
const MAX_LOOKBACK_MS = 3 * 86_400_000;

/**
 * GET /api/activity?since=<epoch ms> → { items: ActivityItem[] }: who
 * confirmed or commented on the signed-in person's reports since then, and
 * reports the NWS confirmed.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  after(maybeSyncNwsConfirmations);
  const now = Date.now();
  const raw = Number(new URL(req.url).searchParams.get("since"));
  const since = Number.isFinite(raw) ? Math.min(now, Math.max(raw, now - MAX_LOOKBACK_MS)) : now - 3_600_000;
  return Response.json({ items: await listActivity(user.id, since) }, { headers: noStore });
}
