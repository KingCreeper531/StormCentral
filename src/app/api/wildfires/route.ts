import { wildfiresFeed } from "@/lib/feeds/wildfires";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/wildfires?lat&lon — active wildfires nearby (NIFC). */
export const GET = feedRoute(wildfiresFeed);
