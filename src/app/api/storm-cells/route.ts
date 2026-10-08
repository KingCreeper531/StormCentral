import { stormCellsFeed } from "@/lib/feeds/storm-cells";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/storm-cells — NEXRAD storm-cell attributes (hail, rotation, motion). */
export const GET = feedRoute(stormCellsFeed);
