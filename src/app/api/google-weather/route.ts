import { HttpError } from "@/lib/api/http";
import { googleWeatherKey, loadGoogleWeather } from "@/lib/server/google-weather";
import { badRequest, errorResponse, jsonResponse } from "@/lib/server/respond";

/**
 * GET /api/google-weather?lat&lon — Google's AI forecast for a point, or
 * 503 { configured: false } when GOOGLE_WEATHER_API_KEY isn't set.
 */
export async function GET(req: Request) {
  if (!googleWeatherKey()) return Response.json({ configured: false }, { status: 503, headers: { "Cache-Control": "public, s-maxage=300" } });
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || sp.get("lat") == null || sp.get("lon") == null) return badRequest("lat/lon required");
  try {
    return jsonResponse(await loadGoogleWeather(lat, lon), 1800);
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) return Response.json({ error: err.message }, { status: 429, headers: { "Cache-Control": "public, s-maxage=3600" } });
    return errorResponse(err);
  }
}
