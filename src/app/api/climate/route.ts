import { climateFeed } from "@/lib/feeds/climate";
import { feedRoute } from "@/lib/server/feed-route";

/** Building the table reads 75 years of daily data from the archive. */
export const maxDuration = 60;

/** GET /api/climate?lat&lon — daily normals and records (ERA5) for the grid cell. */
export const GET = feedRoute(climateFeed);
