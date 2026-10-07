import { gnssFeed } from "@/lib/feeds/gnss";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/gnss?lat&lon — GNSS sky geometry, DOP and a 24 h visibility timeline (SGP4). */
export const GET = feedRoute(gnssFeed);
