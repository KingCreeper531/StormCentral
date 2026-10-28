import { aviationAirportFeed } from "@/lib/feeds/aviation";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/aviation/airport?id=KOKC — one airport's latest METAR and TAF. */
export const GET = feedRoute(aviationAirportFeed);
