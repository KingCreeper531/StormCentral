import { buoysFeed } from "@/lib/feeds/buoys";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/buoys — NOAA NDBC buoy and coastal station observations (see lib/feeds/buoys). */
export const GET = feedRoute(buoysFeed);
