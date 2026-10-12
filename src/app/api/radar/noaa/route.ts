import { noaaTimesFeed } from "@/lib/feeds/radar";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/radar/noaa?workspace&layer&minutes — MRMS / super-res NEXRAD times from NOAA. */
export const GET = feedRoute(noaaTimesFeed);
