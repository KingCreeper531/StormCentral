import { aviationMetarsFeed } from "@/lib/feeds/aviation";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/aviation/metars?bbox=-100,30,-90,40 — airports and their flight category, by 10° tile (see lib/feeds/aviation). */
export const GET = feedRoute(aviationMetarsFeed);
