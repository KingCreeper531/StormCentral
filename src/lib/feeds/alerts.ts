import { normalizeAlerts, POLYGON_EVENTS, type RawAlertFeature } from "../alerts";
import type { AlertsResponse } from "../api/types";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

const NWS = "https://api.weather.gov/alerts/active";
const HEADERS = { Accept: "application/geo+json" };

/**
 * `scope=national` → storm-based warning polygons (CONUS+).
 * `lat` & `lon`    → every active alert covering a point.
 */
export const alertsFeed: Feed<AlertsResponse> = {
  path: "/api/alerts",
  maxAge: (sp) => (sp.get("scope") === "national" ? 45 : 60),
  async load(sp) {
    if (sp.get("scope") === "national") {
      return cached("alerts:national", 45_000, async () => {
        const url = `${NWS}?status=actual&message_type=alert,update&event=${POLYGON_EVENTS.map(encodeURIComponent).join(",")}`;
        const raw = await upstreamJson<{ features?: RawAlertFeature[] }>(url, { headers: HEADERS, timeoutMs: 20_000 });
        const alerts = normalizeAlerts(raw.features ?? []).filter((a) => a.geometry);
        return { alerts, updated: new Date().toISOString() };
      });
    }

    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    const point = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
    return cached(`alerts:${point}`, 60_000, async () => {
      const raw = await upstreamJson<{ features?: RawAlertFeature[] }>(`${NWS}?status=actual&point=${point}`, { headers: HEADERS });
      return { alerts: normalizeAlerts(raw.features ?? []), updated: new Date().toISOString() };
    });
  },
};
