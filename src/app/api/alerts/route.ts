import { alertsFeed } from "@/lib/feeds/alerts";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/alerts?scope=national | ?lat&lon — NWS alerts (see lib/feeds/alerts). */
export const GET = feedRoute(alertsFeed);
