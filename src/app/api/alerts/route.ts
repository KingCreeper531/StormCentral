import { normalizeAlerts, POLYGON_EVENTS, type RawAlertFeature } from "@/lib/alerts";
import type { AlertsResponse } from "@/lib/api/types";
import { cached } from "@/lib/server/cache";
import { badRequest, errorResponse, jsonResponse, parseLatLon, upstreamJson } from "@/lib/server/upstream";

const NWS = "https://api.weather.gov/alerts/active";
const HEADERS = { Accept: "application/geo+json" };

/**
 * GET /api/alerts?scope=national → storm-based warning polygons (CONUS+)
 * GET /api/alerts?lat=..&lon=..   → every active alert covering a point
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("scope") === "national") {
      const data = await cached("alerts:national", 45_000, async () => {
        const url = `${NWS}?status=actual&message_type=alert,update&event=${POLYGON_EVENTS.map(encodeURIComponent).join(",")}`;
        const raw = await upstreamJson<{ features?: RawAlertFeature[] }>(url, { headers: HEADERS, timeoutMs: 20_000 });
        const alerts = normalizeAlerts(raw.features ?? []).filter((a) => a.geometry);
        return { alerts, updated: new Date().toISOString() } satisfies AlertsResponse;
      });
      return jsonResponse(data, 45);
    }

    const p = parseLatLon(sp);
    if (!p) return badRequest("lat/lon required");
    const point = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
    const data = await cached(`alerts:${point}`, 60_000, async () => {
      const raw = await upstreamJson<{ features?: RawAlertFeature[] }>(`${NWS}?status=actual&point=${point}`, { headers: HEADERS });
      return { alerts: normalizeAlerts(raw.features ?? []), updated: new Date().toISOString() } satisfies AlertsResponse;
    });
    return jsonResponse(data, 60);
  } catch (err) {
    return errorResponse(err);
  }
}
