import { intlTimesFeed } from "@/lib/feeds/radar";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/radar/intl?src=eccc&minutes=120 — another country's radar times (see lib/radar/intl). */
export const GET = feedRoute(intlTimesFeed);
