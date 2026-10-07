import { riversFeed } from "@/lib/feeds/rivers";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/rivers?lat&lon — nearest USGS stream gauges with 48 h history. */
export const GET = feedRoute(riversFeed);
