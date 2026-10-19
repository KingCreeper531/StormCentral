import { hazardsFeed } from "@/lib/feeds/hazards";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/hazards — every active watch, warning, advisory and discussion polygon (see lib/feeds/hazards). */
export const GET = feedRoute(hazardsFeed);
