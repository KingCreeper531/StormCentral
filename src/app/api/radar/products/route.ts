import { radarProductsFeed } from "@/lib/feeds/radar";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/radar/products?site — Level-III products IEM has for the last hour. */
export const GET = feedRoute(radarProductsFeed);
