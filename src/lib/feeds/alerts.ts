import { baseRank, hazardColor, impactTags, normalizeAlert, normalizeAlerts, POLYGON_EVENTS, type RawAlertFeature } from "../alerts";
import type { PolygonalGeometry } from "../geo";
import { archiveMaxAge, archiveTime, isoMinute } from "../radar/archive";
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
 * `at`             → the storm-based warnings in effect at a past time (IEM's archive; warnings have had
 *                    polygons since October 2007).
 */
export const alertsFeed: Feed<AlertsResponse | AlertTextResponse> = {
  path: "/api/alerts",
  maxAge: (sp) => (sp.has("at") ? archiveMaxAge(sp.get("at"), 60) : sp.get("scope") === "national" ? 45 : sp.has("product") ? 3600 : 60),
  async load(sp) {
    if (sp.has("at")) {
      const at = archiveTime(sp.get("at"));
      if (at == null) throw badParams("at must be a time from 1995 to now");
      const ts = isoMinute(at);
      return cached(`alerts:at:${ts}`, archiveMaxAge(ts, 60) * 1000, async () => {
        const raw = await upstreamJson<{ features?: IemSbwFeature[] }>(`https://mesonet.agron.iastate.edu/geojson/sbw.geojson?ts=${ts}`, { timeoutMs: 20_000 });
        return { alerts: parseIemWarnings(raw.features ?? []), updated: ts };
      });
    }
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

export interface IemSbwFeature {
  id?: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    ps: string;
    wfo: string;
    phenomena: string;
    significance: string;
    eventid?: number;
    year?: number;
    issue: string;
    expire_utc?: string;
    polygon_begin?: string;
    polygon_end?: string;
    product_id?: string;
    windtag?: number | null;
    hailtag?: number | null;
    tornadotag?: string | null;
    damagetag?: string | null;
    floodtag_damage?: string | null;
    is_emergency?: boolean;
    is_pds?: boolean;
  };
}

const POLYGONS = new Set<string>(POLYGON_EVENTS);

/**
 * IEM's archive of storm-based warnings (the polygons in effect at a time) as
 * alerts like the live ones: colour, rank and impact tags from the warning's
 * own tags. The text is fetched from IEM's product archive when one is opened.
 */
export function parseIemWarnings(features: IemSbwFeature[]): WeatherAlert[] {
  const out: WeatherAlert[] = [];
  for (const f of features) {
    const p = f.properties;
    // The warnings the live map draws (not river flood warnings or advisories).
    if (!p?.ps || !POLYGONS.has(p.ps) || !f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) continue;
    // IEM keeps one damage tag: the tornado threat on tornado warnings, the thunderstorm threat on severe ones.
    const { tags, bonus } = impactTags({
      event: p.ps,
      tornadoThreat: p.phenomena === "TO" ? p.damagetag : null,
      tstmThreat: p.phenomena === "SV" ? p.damagetag : null,
      ffThreat: p.floodtag_damage,
      tornadoDetection: p.tornadotag,
      tornadoEmergency: !!p.is_emergency && p.phenomena !== "FF",
      ffEmergency: !!p.is_emergency && p.phenomena === "FF",
      pds: !!p.is_pds,
    });
    const rank = baseRank(p.ps) + bonus;
    const ends = p.polygon_end ?? p.expire_utc ?? p.issue;
    out.push({
      id: `iem-${f.id ?? `${p.wfo}-${p.phenomena}.${p.significance}-${p.year ?? p.issue.slice(0, 4)}-${p.eventid ?? p.issue}`}`,
      event: p.ps,
      headline: null,
      severity: "Unknown",
      urgency: "Unknown",
      certainty: "Unknown",
      sent: p.polygon_begin ?? p.issue,
      effective: p.polygon_begin ?? p.issue,
      expires: ends,
      ends,
      areaDesc: "",
      sender: `NWS ${p.wfo}`,
      description: "",
      instruction: null,
      hazards: {
        // As the live alerts write them: "1.00", "60 MPH".
        maxHail: p.hailtag ? p.hailtag.toFixed(2) : undefined,
        maxWind: p.windtag ? `${p.windtag} MPH` : undefined,
        tornado: p.tornadotag ?? undefined,
        damageThreat: p.damagetag ?? p.floodtag_damage ?? undefined,
      },
      tags,
      color: hazardColor(p.ps),
      rank,
      motion: null,
      geometry: f.geometry as PolygonalGeometry,
      // The text comes from IEM's product archive (`useAlertText`) when it's opened.
      lean: !!p.product_id,
      url: p.product_id ? `https://mesonet.agron.iastate.edu/api/1/nwstext/${p.product_id}` : null,
    });
  }
  return out.sort((a, b) => b.rank - a.rank);
}
