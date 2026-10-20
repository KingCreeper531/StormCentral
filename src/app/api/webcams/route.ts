import { webcamsFeed } from "@/lib/feeds/webcams";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/webcams — live cameras for the radar map (see lib/feeds/webcams). */
export const GET = feedRoute(webcamsFeed);
