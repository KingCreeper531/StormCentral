import { floodGaugesFeed } from "@/lib/feeds/flood-gauges";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/flood-gauges?lat&lon — nearby NWS river forecast points with flood stages. */
export const GET = feedRoute(floodGaugesFeed);
