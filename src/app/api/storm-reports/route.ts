import { stormReportsFeed } from "@/lib/feeds/storm-reports";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/storm-reports?hours=6 — official NWS local storm reports. */
export const GET = feedRoute(stormReportsFeed);
