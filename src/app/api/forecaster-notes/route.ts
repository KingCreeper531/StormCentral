import { forecasterNotesFeed } from "@/lib/feeds/forecaster-notes";
import { feedRoute } from "@/lib/server/feed-route";

/** GET /api/forecaster-notes?lat&lon — the local NWS office's latest Area Forecast Discussion. */
export const GET = feedRoute(forecasterNotesFeed);
