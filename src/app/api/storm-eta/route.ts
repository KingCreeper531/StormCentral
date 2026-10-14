import { stormCellsFeed } from "@/lib/feeds/storm-cells";
import { badRequest, errorResponse, jsonResponse } from "@/lib/server/respond";
import { incomingStorms, type StormEtaResponse } from "@/lib/storm-eta";

/**
 * GET /api/storm-eta?lat&lon → StormEtaResponse: strong radar storm cells
 * heading for the point within the hour (NEXRAD storm tracking via IEM).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return badRequest("lat/lon required");
  try {
    const { cells, updated } = await stormCellsFeed.load(new URLSearchParams());
    const body: StormEtaResponse = { storms: incomingStorms(cells, { lat, lon }, Date.now()), updated };
    return jsonResponse(body, 120);
  } catch (err) {
    return errorResponse(err);
  }
}
