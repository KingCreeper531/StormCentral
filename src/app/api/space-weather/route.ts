import { spaceWeatherFeed } from "@/lib/feeds/space-weather";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/space-weather — observed and forecast planetary Kp (NOAA SWPC). */
export const GET = feedRoute(spaceWeatherFeed);
