import { tropicalFeed } from "@/lib/feeds/tropical";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/tropical — active tropical cyclones: cone, track, forecast points (NHC). */
export const GET = feedRoute(tropicalFeed);
