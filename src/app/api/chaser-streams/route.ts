import { chaserStreams } from "@/lib/server/chaser-streams";
import { cachedJsonResponse, errorResponse } from "@/lib/server/respond";

/**
 * GET /api/chaser-streams → ChaserStreamsResponse: which storm chasers are
 * live on YouTube right now. Public YouTube data only (never anyone's
 * position), so the CDN shares it between everyone for two minutes.
 */
export async function GET(req: Request) {
  try {
    return cachedJsonResponse(req, await chaserStreams(), 120);
  } catch (err) {
    return errorResponse(err);
  }
}
