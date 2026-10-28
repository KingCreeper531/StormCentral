import { aviationAdvisoriesFeed } from "@/lib/feeds/aviation";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/aviation/advisories — SIGMETs, convective SIGMETs and (G-)AIRMETs over the US. */
export const GET = feedRoute(aviationAdvisoriesFeed);
