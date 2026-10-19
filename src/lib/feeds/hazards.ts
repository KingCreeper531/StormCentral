/**
 * Every active hazard polygon, not just storm-based warnings: the NWS
 * watch/warning/advisory map (zone- and county-based products as drawn on
 * weather.gov), SPC mesoscale discussions and watch boxes, WPC mesoscale
 * precipitation discussions, and the national warnings of Canada (ECCC) and
 * Germany (DWD).
 *
 * The NWS map layer has no product text, so those alerts are sent "lean" (no
 * description): the full text is fetched from api.weather.gov when one is
 * opened (`/api/alerts?id=`). Each source is fetched and cached separately; a
 * failing source drops out without taking the rest with it.
 */
import { alertCategory, baseRank, CATEGORY_COLORS, hazardColor, type AlertCategory } from "../alerts";
import type { AlertsResponse, AlertSource, WeatherAlert } from "../api/types";
import type { PolygonalGeometry } from "../geo";
import { cached } from "./cache";
import type { Feed } from "./types";
import { upstreamJson } from "./upstream";

const WWA = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query";
const IEM = "https://mesonet.agron.iastate.edu/api/1";
const ECCC = "https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000&lang=en";
const DWD = "https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Gemeinden_vereinigt&outputFormat=application/json&srsName=EPSG:4326";

type Position = [number, number];
type Polygon = Position[][];
interface GeoFeature<P> {
  geometry: { type: string; coordinates: unknown } | null;
  properties: P;
}
interface FeatureCollection<P> {
  features?: GeoFeature<P>[];
}

export interface HazardsResponse extends AlertsResponse {
  /** Sources that failed this time (their polygons are missing). */
  failed: AlertSource[];
}

/* ---------- Geometry helpers ---------- */

/** Douglas–Peucker on one ring (degrees), keeping at least a triangle. */
export function simplifyRing(ring: Position[], tolerance: number): Position[] {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  const last = ring.length - 1;
  // A closed ring starts and ends on the same point: split it at the vertex farthest from the start.
  let far = 1;
  for (let i = 2; i < last; i++) if (Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]) > Math.hypot(ring[far]![0] - ring[0]![0], ring[far]![1] - ring[0]![1])) far = i;
  keep[0] = keep[last] = keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, last],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a]!;
    const [bx, by] = ring[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i]!;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

const round3 = (p: Position): Position => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];

/** Polygons of a GeoJSON geometry (Polygon or MultiPolygon), simplified and rounded. */
function polygonsOf(g: GeoFeature<unknown>["geometry"], tolerance: number): Polygon[] {
  if (!g) return [];
  const polys = g.type === "Polygon" ? [g.coordinates as Polygon] : g.type === "MultiPolygon" ? (g.coordinates as Polygon[]) : [];
  return polys
    .map((poly) => poly.map((ring) => simplifyRing(ring, tolerance).map(round3)).filter((ring) => ring.length >= 4))
    .filter((poly) => poly.length > 0);
}

function merge(polys: Polygon[]): PolygonalGeometry | null {
  if (!polys.length) return null;
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0]! } : { type: "MultiPolygon", coordinates: polys };
}

/** Group features that are pieces of one product (one per zone or area) under a key. */
function group<P>(features: GeoFeature<P>[], key: (p: P) => string, tolerance: number) {
  const out = new Map<string, { props: P; polys: Polygon[]; count: number }>();
  for (const f of features) {
    const k = key(f.properties);
    const polys = polygonsOf(f.geometry, tolerance);
    const g = out.get(k);
    if (g) {
      g.polys.push(...polys);
      g.count++;
    } else out.set(k, { props: f.properties, polys, count: 1 });
  }
  return [...out.values()];
}

const iso = (v: string | number | null | undefined): string | null => {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function alert(base: Pick<WeatherAlert, "id" | "event" | "sent" | "expires" | "geometry"> & Partial<WeatherAlert> & { source: AlertSource }): WeatherAlert {
  const category: AlertCategory = base.category ?? alertCategory(base.event);
  return {
    headline: null,
    severity: "Unknown",
    urgency: "Unknown",
    certainty: "Unknown",
    effective: base.sent,
    ends: null,
    areaDesc: "",
    sender: "National Weather Service",
    description: "",
    instruction: null,
    hazards: {},
    tags: [],
    color: hazardColor(base.event),
    rank: baseRank(base.event),
    motion: null,
    area: true,
    ...base,
    category,
  };
}

/* ---------- NWS watch / warning / advisory map ---------- */

interface WwaProps {
  cap_id?: string;
  prod_type?: string;
  wfo?: string;
  issuance?: string;
  onset?: string | null;
  expiration?: string;
  ends?: string | null;
  url?: string | null;
}

export function parseWwa(fc: FeatureCollection<WwaProps>, now = Date.now()): WeatherAlert[] {
  const live = (fc.features ?? []).filter((f) => {
    const p = f.properties;
    const end = Date.parse(p.ends || p.expiration || "");
    return p.cap_id && p.prod_type && (!Number.isFinite(end) || end > now);
  });
  return group(live, (p) => p.cap_id!, 0.004).flatMap(({ props: p, polys }) => {
    const geometry = merge(polys);
    if (!geometry) return [];
    const sent = iso(p.issuance) ?? new Date(now).toISOString();
    return [
      alert({
        source: "nws",
        id: p.cap_id!,
        event: p.prod_type!,
        sent,
        effective: iso(p.onset) ?? sent,
        expires: iso(p.expiration) ?? iso(p.ends) ?? sent,
        ends: iso(p.ends),
        sender: p.wfo ? `NWS ${p.wfo.replace(/^[KP](?=[A-Z]{3}$)/, "")}` : "National Weather Service",
        lean: true,
        url: p.url ?? null,
        geometry,
      }),
    ];
  });
}

/* ---------- SPC / WPC ---------- */

interface IemDiscussionProps {
  product_id?: string;
  year?: number;
  num?: number;
  issue?: string;
  expire?: string;
  watch_confidence?: number | null;
  concerning?: string | null;
}

export function parseDiscussions(fc: FeatureCollection<IemDiscussionProps>, kind: "spc" | "wpc", now = Date.now()): WeatherAlert[] {
  return (fc.features ?? []).flatMap((f) => {
    const p = f.properties;
    const expires = iso(p.expire);
    const geometry = merge(polygonsOf(f.geometry, 0.002));
    if (!p.num || !expires || Date.parse(expires) <= now || !geometry) return [];
    const spc = kind === "spc";
    const num = String(p.num).padStart(4, "0");
    const concerning = (p.concerning ?? "").replace(/\s+/g, " ").trim();
    const conf = p.watch_confidence != null ? ` Probability of watch issuance: ${Math.round(p.watch_confidence)}%.` : "";
    return [
      alert({
        source: kind,
        id: `${kind}-${spc ? "md" : "mpd"}-${p.year}-${num}`,
        event: spc ? "Mesoscale Discussion" : "Mesoscale Precipitation Discussion",
        headline: `${spc ? "Mesoscale Discussion" : "MPD"} #${num}${concerning ? ` · ${concerning}` : ""}`,
        sent: iso(p.issue) ?? new Date(now).toISOString(),
        expires,
        sender: spc ? "Storm Prediction Center" : "Weather Prediction Center",
        description: `${concerning ? `Concerning: ${concerning}.` : ""}${conf}`.trim(),
        // The discussion text itself comes from IEM's text archive when opened.
        lean: !!p.product_id,
        url: p.product_id ? `${IEM}/nwstext/${p.product_id}` : null,
        area: false,
        geometry,
      }),
    ];
  });
}

interface WatchOutlineProps {
  type?: string;
  num?: number;
  utc_issued?: string;
  utc_expired?: string;
}

export function parseWatchOutlines(fc: FeatureCollection<WatchOutlineProps>, now = Date.now()): WeatherAlert[] {
  return (fc.features ?? []).flatMap((f) => {
    const p = f.properties;
    const expires = iso(p.utc_expired);
    const geometry = merge(polygonsOf(f.geometry, 0.001));
    if (!p.num || !expires || Date.parse(expires) <= now || !geometry) return [];
    const event = p.type === "TOR" ? "Tornado Watch" : "Severe Thunderstorm Watch";
    return [
      alert({
        source: "spc",
        id: `spc-ww-${p.num}`,
        event,
        headline: `${event} ${p.num}`,
        sent: iso(p.utc_issued) ?? new Date(now).toISOString(),
        expires,
        sender: "Storm Prediction Center",
        description: `The ${event.toLowerCase()} box issued by the Storm Prediction Center. The counties in the watch are drawn by the local NWS offices.`,
        url: `https://www.spc.noaa.gov/products/watch/ww${String(p.num).padStart(4, "0")}.html`,
        area: false,
        // Outline only: the county-based watch underneath carries the fill.
        category: "watch",
        rank: baseRank(event) - 1,
        geometry,
      }),
    ];
  });
}

/* ---------- Canada: Environment and Climate Change Canada ---------- */

interface EcccProps {
  alert_code?: string;
  alert_type?: string;
  alert_name_en?: string;
  alert_text_en?: string;
  feature_name_en?: string;
  province?: string;
  publication_datetime?: string;
  expiration_datetime?: string;
  event_end_datetime?: string | null;
  risk_colour_en?: string | null;
  impact_en?: string | null;
  confidence_en?: string | null;
}

/** Short stable hash (FNV-1a) for ids built from text. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const ECCC_RISK: Record<string, string> = { yellow: "#facc15", orange: "#f97316", red: "#dc2626" };
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

export function parseEccc(fc: FeatureCollection<EcccProps>, now = Date.now()): WeatherAlert[] {
  const live = (fc.features ?? []).filter((f) => {
    const end = Date.parse(f.properties.event_end_datetime || f.properties.expiration_datetime || "");
    return f.properties.alert_name_en && (!Number.isFinite(end) || end > now);
  });
  const key = (p: EcccProps) => [p.alert_code, p.alert_name_en, p.province, p.publication_datetime, (p.alert_text_en ?? "").slice(0, 120)].join("|");
  return group(live, key, 0.004).flatMap(({ props: p, polys }) => {
    const geometry = merge(polys);
    if (!geometry) return [];
    const event = titleCase(p.alert_name_en!.trim());
    const type = p.alert_type ?? "";
    const category: AlertCategory = type === "warning" ? "warning" : type === "watch" ? "watch" : type === "advisory" ? "advisory" : "statement";
    const areas = [...new Set(live.filter((f) => key(f.properties) === key(p)).map((f) => f.properties.feature_name_en).filter(Boolean))] as string[];
    const sent = iso(p.publication_datetime) ?? new Date(now).toISOString();
    return [
      alert({
        source: "eccc",
        // Stable across refreshes (the feed's order isn't), so a selected alert stays selected.
        id: `eccc-${p.province ?? "ca"}-${p.alert_code ?? "x"}-${hash(key(p))}`,
        event,
        sent,
        expires: iso(p.expiration_datetime) ?? sent,
        ends: iso(p.event_end_datetime),
        areaDesc: areas.join("; "),
        sender: "Environment and Climate Change Canada",
        description: (p.alert_text_en ?? "").trim(),
        severity: p.risk_colour_en === "red" ? "Extreme" : p.risk_colour_en === "orange" ? "Severe" : p.risk_colour_en === "yellow" ? "Moderate" : "Minor",
        color: (p.risk_colour_en && ECCC_RISK[p.risk_colour_en.toLowerCase()]) || hazardColor(event) || CATEGORY_COLORS[category],
        category,
        url: "https://weather.gc.ca/warnings/index_e.html",
        geometry,
      }),
    ];
  });
}

/* ---------- Germany: Deutscher Wetterdienst ---------- */

interface DwdProps {
  IDENTIFIER?: string;
  EVENT?: string;
  SEVERITY?: string;
  HEADLINE?: string;
  DESCRIPTION?: string;
  INSTRUCTION?: string | null;
  EC_AREA_COLOR?: string;
  SENT?: string;
  ONSET?: string;
  EFFECTIVE?: string;
  EXPIRES?: string | null;
  AREADESC?: string | null;
  MSGTYPE?: string;
}

/** DWD event names (German, upper case) in English. */
const DWD_EVENTS: Record<string, string> = {
  WINDBÖEN: "Wind gusts",
  STURMBÖEN: "Gale-force gusts",
  "SCHWERE STURMBÖEN": "Severe gale-force gusts",
  "ORKANARTIGE BÖEN": "Violent storm gusts",
  ORKANBÖEN: "Hurricane-force gusts",
  "EXTREME ORKANBÖEN": "Extreme hurricane-force gusts",
  GEWITTER: "Thunderstorm",
  "STARKES GEWITTER": "Strong thunderstorm",
  "SCHWERES GEWITTER": "Severe thunderstorm",
  "EXTREMES GEWITTER": "Extreme thunderstorm",
  STARKREGEN: "Heavy rain",
  "HEFTIGER STARKREGEN": "Very heavy rain",
  "EXTREM HEFTIGER STARKREGEN": "Extremely heavy rain",
  DAUERREGEN: "Persistent rain",
  "ERGIEBIGER DAUERREGEN": "Heavy persistent rain",
  "EXTREM ERGIEBIGER DAUERREGEN": "Extreme persistent rain",
  SCHNEEFALL: "Snowfall",
  "STARKER SCHNEEFALL": "Heavy snowfall",
  "EXTREM STARKER SCHNEEFALL": "Extreme snowfall",
  SCHNEEVERWEHUNG: "Snow drifts",
  "STARKE SCHNEEVERWEHUNG": "Heavy snow drifts",
  GLÄTTE: "Slippery roads",
  GLATTEIS: "Black ice",
  FROST: "Frost",
  "STRENGER FROST": "Severe frost",
  NEBEL: "Fog",
  HITZE: "Heat",
  "STARKE HITZE": "Severe heat",
  "EXTREME HITZE": "Extreme heat",
  TAUWETTER: "Thaw",
  "STARKES TAUWETTER": "Strong thaw",
  "UV-INDEX": "High UV index",
};

const DWD_SEVERITY: Record<string, string> = { Minor: "Minor", Moderate: "Moderate", Severe: "Severe", Extreme: "Extreme" };

export function parseDwd(fc: FeatureCollection<DwdProps>, now = Date.now()): WeatherAlert[] {
  const live = (fc.features ?? []).filter((f) => {
    const end = Date.parse(f.properties.EXPIRES ?? "");
    return f.properties.IDENTIFIER && f.properties.EVENT && (!Number.isFinite(end) || end > now);
  });
  return group(live, (p) => p.IDENTIFIER!, 0.004).flatMap(({ props: p, polys }) => {
    const geometry = merge(polys);
    if (!geometry) return [];
    const raw = p.EVENT!.trim().toUpperCase();
    const english = DWD_EVENTS[raw] ?? titleCase(p.EVENT!.toLowerCase());
    const pre = /VORABINFORMATION/i.test(p.HEADLINE ?? "");
    const category: AlertCategory = pre ? "watch" : p.SEVERITY === "Minor" ? "advisory" : "warning";
    const rgb = (p.EC_AREA_COLOR ?? "").split(/\s+/).map(Number);
    const color = rgb.length === 3 && rgb.every((n) => Number.isFinite(n)) ? `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}` : CATEGORY_COLORS[category];
    const sent = iso(p.SENT) ?? new Date(now).toISOString();
    const severity = DWD_SEVERITY[p.SEVERITY ?? ""] ?? "Unknown";
    return [
      alert({
        source: "dwd",
        id: `dwd-${p.IDENTIFIER}`,
        event: `${english} ${pre ? "pre-warning" : category === "advisory" ? "advisory" : "warning"} (DWD)`,
        headline: p.HEADLINE ?? null,
        sent,
        effective: iso(p.ONSET) ?? iso(p.EFFECTIVE) ?? sent,
        expires: iso(p.EXPIRES) ?? new Date(now + 6 * 3_600_000).toISOString(),
        areaDesc: p.AREADESC ?? "",
        sender: "Deutscher Wetterdienst",
        severity,
        description: (p.DESCRIPTION ?? "").trim(),
        instruction: p.INSTRUCTION?.trim() || null,
        color,
        category,
        rank: ({ warning: 32, watch: 24, advisory: 14 } as Record<string, number>)[category]! + ({ Extreme: 30, Severe: 20, Moderate: 10, Minor: 0 }[severity] ?? 0),
        url: "https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html",
        geometry,
      }),
    ];
  });
}

/* ---------- Feed ---------- */

const SOURCES: { id: AlertSource; ttl: number; load: () => Promise<WeatherAlert[]> }[] = [
  {
    id: "nws",
    ttl: 90_000,
    load: async () =>
      parseWwa(
        await upstreamJson<FeatureCollection<WwaProps>>(
          `${WWA}?where=1%3D1&outFields=cap_id,prod_type,wfo,issuance,onset,expiration,ends,url&returnGeometry=true&maxAllowableOffset=0.01&geometryPrecision=3&outSR=4326&f=geojson`,
          { timeoutMs: 25_000 },
        ),
      ),
  },
  {
    id: "spc",
    ttl: 120_000,
    load: async () => {
      const [mds, watches] = await Promise.all([
        upstreamJson<FeatureCollection<IemDiscussionProps>>(`${IEM}/nws/spc_mcd.geojson`),
        upstreamJson<FeatureCollection<WatchOutlineProps>>(`${IEM}/spc_watch_outline.geojson`).catch(() => ({ features: [] })),
      ]);
      return [...parseDiscussions(mds, "spc"), ...parseWatchOutlines(watches)];
    },
  },
  { id: "wpc", ttl: 120_000, load: async () => parseDiscussions(await upstreamJson<FeatureCollection<IemDiscussionProps>>(`${IEM}/nws/wpc_mpd.geojson`), "wpc") },
  { id: "eccc", ttl: 180_000, load: async () => parseEccc(await upstreamJson<FeatureCollection<EcccProps>>(ECCC, { timeoutMs: 15_000 })) },
  { id: "dwd", ttl: 180_000, load: async () => parseDwd(await upstreamJson<FeatureCollection<DwdProps>>(DWD, { timeoutMs: 15_000 })) },
];

/**
 * `/api/hazards?sources=nws,spc,wpc,eccc,dwd` (all by default). Sorted
 * low-rank first is left to the map; this returns highest rank first like
 * the other alert feeds.
 */
export const hazardsFeed: Feed<HazardsResponse> = {
  path: "/api/hazards",
  maxAge: 60,
  async load(sp) {
    const wanted = new Set((sp.get("sources") ?? "nws,spc,wpc,eccc,dwd").split(",").map((s) => s.trim()));
    const picked = SOURCES.filter((s) => wanted.has(s.id));
    const results = await Promise.allSettled(picked.map((s) => cached(`hazards:${s.id}`, s.ttl, s.load)));
    const failed: AlertSource[] = [];
    const alerts: WeatherAlert[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") alerts.push(...r.value);
      else failed.push(picked[i]!.id);
    });
    const now = Date.now();
    return {
      alerts: alerts.filter((a) => Date.parse(a.ends ?? a.expires) > now).sort((a, b) => b.rank - a.rank),
      updated: new Date(now).toISOString(),
      failed,
    };
  },
};
