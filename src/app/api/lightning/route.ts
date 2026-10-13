import { nearestLightningKm } from "@/lib/server/lightning";
import { badRequest, errorResponse, jsonResponse } from "@/lib/server/respond";

/**
 * GET /api/lightning?lat&lon&radiusKm → { nearestKm: number | null }:
 * lightning in the last 15 minutes within the radius (NOAA nowCOAST).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const radiusKm = Number(sp.get("radiusKm") ?? 16);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return badRequest("lat/lon required");
  if (!Number.isFinite(radiusKm) || radiusKm < 3 || radiusKm > 50) return badRequest("radiusKm must be 3–50");
  try {
    const nearestKm = await nearestLightningKm(lat, lon, radiusKm, AbortSignal.timeout(10_000));
    return jsonResponse({ nearestKm: nearestKm == null ? null : Math.round(nearestKm * 10) / 10 }, 180);
  } catch (err) {
    return errorResponse(err);
  }
}
