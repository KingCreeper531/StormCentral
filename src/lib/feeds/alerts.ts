import { normalizeAlert, normalizeAlerts, POLYGON_EVENTS, type RawAlertFeature } from "../alerts";
import type { AlertsResponse, WeatherAlert } from "../api/types";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson, upstreamText } from "./upstream";

const NWS = "https://api.weather.gov/alerts/active";
const HEADERS = { Accept: "application/geo+json" };

/**
 * `scope=national` → storm-based warning polygons (CONUS+).
 * `lat` & `lon`    → every active alert covering a point.
 * `id`             → one alert with its full text (the hazard map sends NWS alerts without it).
 * `product`        → an SPC/WPC product's text from IEM's archive (mesoscale discussions).
 */
export const alertsFeed: Feed<AlertsResponse | AlertTextResponse> = {
  path: "/api/alerts",
  maxAge: (sp) => (sp.get("scope") === "national" ? 45 : sp.has("product") ? 3600 : 60),
  async load(sp) {
    const id = sp.get("id");
    if (id) {
      // NWS CAP identifiers only ("urn:oid:2.49.0.1.840.0.<hash>.<seq>.<n>").
      if (!/^urn:oid:[0-9a-f.]+$/i.test(id) || id.length > 120) throw badParams("invalid alert id");
      return cached(`alert:${id}`, 120_000, async () => {
        const raw = await upstreamJson<RawAlertFeature>(`${NWS.replace(/\/active$/, "")}/${id}`, { headers: HEADERS });
        return { alert: normalizeAlert(raw), text: null };
      });
    }
    const product = sp.get("product");
    if (product) {
      if (!/^\d{12}-[A-Z]{4}-[A-Z0-9]{6}-[A-Z0-9]{3,8}(?:-[A-Z0-9]{3})?$/.test(product)) throw badParams("invalid product id");
      return cached(`product:${product}`, 3_600_000, async () => ({ alert: null, text: (await upstreamText(`https://mesonet.agron.iastate.edu/api/1/nwstext/${product}`)).trim() }));
    }
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

export interface AlertTextResponse {
  alert: WeatherAlert | null;
  /** Raw product text (SPC/WPC discussions). */
  text: string | null;
}
