import { climateFeed } from "@/lib/feeds/climate";
import { feedRoute } from "@/lib/server/feed-route";

/** Up to four ACIS requests on a cold cache. */
export const maxDuration = 30;

/** GET /api/climate?lat&lon — daily normals and records from the nearest long-record station (NOAA ACIS). */
export const GET = feedRoute(climateFeed);
