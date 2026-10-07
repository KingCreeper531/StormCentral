import { outlookFeed } from "@/lib/feeds/outlook";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/outlook?day=1 — SPC categorical convective outlook polygons. */
export const GET = feedRoute(outlookFeed);
