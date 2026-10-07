import { radarScansFeed } from "@/lib/feeds/radar";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/radar/scans?site&product&minutes — volume-scan index from IEM. */
export const GET = feedRoute(radarScansFeed);
