/**
 * Pure parsers for upstream feeds (no I/O — unit-tested with fixtures).
 * Each one is deliberately tolerant: government feeds change shape with
 * little notice, and a partial result beats a blank panel.
 */
import type { GnssElements, KpPoint, OutlookFeature, RiverParam, RiverSite } from "../api/types";
import { haversineKm, type LatLon, type PolygonalGeometry } from "../geo";

// ─── NOAA SWPC planetary Kp ────────────────────────────────────────────────

function swpcTime(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function kindOf(v: unknown, fallback: KpPoint["kind"]): KpPoint["kind"] {
  return v === "observed" || v === "estimated" || v === "predicted" ? v : fallback;
}

/**
 * Accepts both SWPC layouts: legacy array-of-arrays with a header row, and
 * the newer array-of-objects.
 */
export function parseKp(raw: unknown, fallbackKind: KpPoint["kind"]): KpPoint[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: KpPoint[] = [];
  if (Array.isArray(raw[0])) {
    const header = (raw[0] as unknown[]).map((h) => String(h).toLowerCase());
    const iT = header.indexOf("time_tag");
    const iK = header.findIndex((h) => h === "kp" || h === "kp_index");
    const iObs = header.indexOf("observed");
    if (iT < 0 || iK < 0) return [];
    for (const row of raw.slice(1) as unknown[][]) {
      const time = swpcTime(row[iT]);
      const kp = Number(row[iK]);
      if (time && Number.isFinite(kp)) out.push({ time, kp, kind: kindOf(iObs >= 0 ? row[iObs] : null, fallbackKind) });
    }
    return out;
  }
  for (const r of raw as Record<string, unknown>[]) {
    const time = swpcTime(r.time_tag);
    const kp = Number(r.Kp ?? r.kp ?? r.kp_index ?? r.estimated_kp);
    if (time && Number.isFinite(kp)) out.push({ time, kp, kind: kindOf(r.observed, fallbackKind) });
  }
  return out;
}

// ─── USGS NWIS instantaneous values ────────────────────────────────────────

const PARAMS = { "00060": "discharge", "00065": "gageHeight", "00010": "waterTemp" } as const;
type ParamKey = (typeof PARAMS)[keyof typeof PARAMS];

interface IvSeries {
  sourceInfo?: {
    siteName?: string;
    siteCode?: { value?: string }[];
    geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } };
  };
  variable?: { variableCode?: { value?: string }[]; unit?: { unitCode?: string }; noDataValue?: number };
  values?: { value?: { value?: string; dateTime?: string }[] }[];
}

function buildParam(points: { t: number; v: number }[], unit: string): RiverParam | null {
  if (!points.length) return null;
  points.sort((a, b) => a.t - b.t);
  // Hourly downsample (last reading per hour) keeps payloads small.
  const hourly = new Map<number, { t: number; v: number }>();
  for (const p of points) hourly.set(Math.floor(p.t / 3_600_000), p);
  const series = [...hourly.values()];
  const latest = points[points.length - 1]!;
  const target = latest.t - 24 * 3_600_000;
  let prev: { t: number; v: number } | null = null;
  for (const p of points) if (Math.abs(p.t - target) < 2 * 3_600_000 && (!prev || Math.abs(p.t - target) < Math.abs(prev.t - target))) prev = p;
  return {
    latest: latest.v,
    latestTime: new Date(latest.t).toISOString(),
    unit,
    series: series.map((p) => ({ t: p.t, v: +p.v.toFixed(3) })),
    change24h: prev && prev.v !== 0 ? (latest.v - prev.v) / Math.abs(prev.v) : null,
    delta24h: prev ? latest.v - prev.v : null,
  };
}

export function parseUsgsIv(raw: unknown, origin: LatLon, limit = 8): RiverSite[] {
  const ts = (raw as { value?: { timeSeries?: IvSeries[] } })?.value?.timeSeries;
  if (!Array.isArray(ts)) return [];
  const sites = new Map<string, Omit<RiverSite, ParamKey> & Partial<Record<ParamKey, RiverParam | null>>>();
  for (const s of ts) {
    const id = s.sourceInfo?.siteCode?.[0]?.value;
    const code = s.variable?.variableCode?.[0]?.value as keyof typeof PARAMS | undefined;
    const geo = s.sourceInfo?.geoLocation?.geogLocation;
    if (!id || !code || !(code in PARAMS) || geo?.latitude == null || geo.longitude == null) continue;
    const noData = s.variable?.noDataValue ?? -999999;
    const block = s.values?.find((b) => (b.value?.length ?? 0) > 0);
    const points = (block?.value ?? [])
      .map((p) => ({ t: Date.parse(p.dateTime ?? ""), v: Number(p.value) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v !== noData);
    if (!sites.has(id)) {
      sites.set(id, {
        id,
        name: titleCase(s.sourceInfo?.siteName ?? id),
        lat: geo.latitude,
        lon: geo.longitude,
        distanceKm: haversineKm(origin, { lat: geo.latitude, lon: geo.longitude }),
      });
    }
    const site = sites.get(id)!;
    site[PARAMS[code]] = buildParam(points, s.variable?.unit?.unitCode ?? "");
  }
  return [...sites.values()]
    .map((s) => ({ ...s, discharge: s.discharge ?? null, gageHeight: s.gageHeight ?? null, waterTemp: s.waterTemp ?? null }))
    .filter((s) => s.discharge || s.gageHeight)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/** Fallback: USGS Water Data OGC API "latest-continuous" collection. */
export function parseUsgsOgcLatest(raw: unknown, origin: LatLon, limit = 8): RiverSite[] {
  const features = (raw as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const sites = new Map<string, RiverSite>();
  for (const f of features as { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }[]) {
    const p = f.properties ?? {};
    const id = String(p.monitoring_location_id ?? "").replace(/^USGS-/, "");
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const code = String(p.parameter_code ?? "") as keyof typeof PARAMS;
    const v = Number(p.value);
    const t = Date.parse(String(p.time ?? ""));
    if (!id || lat == null || lon == null || !(code in PARAMS) || !Number.isFinite(v) || !Number.isFinite(t)) continue;
    const site =
      sites.get(id) ??
      ({ id, name: `USGS ${id}`, lat, lon, distanceKm: haversineKm(origin, { lat, lon }), discharge: null, gageHeight: null, waterTemp: null } as RiverSite);
    site[PARAMS[code]] = buildParam([{ t, v }], String(p.unit_of_measure ?? ""));
    sites.set(id, site);
  }
  return [...sites.values()].filter((s) => s.discharge || s.gageHeight).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}

const SMALL = new Set(["at", "near", "nr", "of", "the", "and", "abv", "blw", "bl", "ab"]);
function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^\w/, (c) => c.toUpperCase())))
    .join(" ")
    .replace(/\b([a-z]{2})$/i, (m) => (m.length === 2 ? m.toUpperCase() : m));
}

// ─── IEM radar index ────────────────────────────────────────────────────────

export function parseIemScans(raw: unknown): string[] {
  const scans = (raw as { scans?: { ts?: string }[] })?.scans;
  if (!Array.isArray(scans)) return [];
  return scans
    .map((s) => s.ts)
    .filter((ts): ts is string => typeof ts === "string")
    .map((ts) => (/(Z|[+-]\d\d:?\d\d)$/.test(ts) ? ts : `${ts}Z`))
    .filter((ts) => Number.isFinite(Date.parse(ts)))
    .map((ts) => new Date(Date.parse(ts)).toISOString());
}

export function parseIemProducts(raw: unknown): string[] {
  const products = (raw as { products?: ({ id?: string } | string)[] })?.products;
  if (!Array.isArray(products)) return [];
  return [
    ...new Set(
      products
        .map((p) => (typeof p === "string" ? p : p.id))
        .filter((id): id is string => typeof id === "string" && /^[A-Z0-9]{3}$/.test(id)),
    ),
  ];
}

// ─── CelesTrak OMM ──────────────────────────────────────────────────────────

const OMM_FIELDS = [
  "OBJECT_NAME",
  "OBJECT_ID",
  "EPOCH",
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
  "EPHEMERIS_TYPE",
  "CLASSIFICATION_TYPE",
  "NORAD_CAT_ID",
  "ELEMENT_SET_NO",
  "REV_AT_EPOCH",
  "BSTAR",
  "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT",
] as const;

export function trimOmm(raw: unknown, constellation: GnssElements["sets"][number]["constellation"]): GnssElements["sets"] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((r) => r && typeof r.EPOCH === "string" && r.MEAN_MOTION != null)
    .map((r) => ({ constellation, omm: Object.fromEntries(OMM_FIELDS.filter((k) => r[k] != null).map((k) => [k, r[k]])) }));
}

// ─── SPC convective outlook ─────────────────────────────────────────────────

type SpcProps = Record<string, unknown>;

export interface SpcParsed {
  features: OutlookFeature[];
  /** Start of the outlook period (ISO), from `VALID_ISO` or `VALID` ("202610071300"). */
  valid: string | null;
  /** End of the outlook period (ISO), from `EXPIRE_ISO` or `EXPIRE`. */
  expires: string | null;
}

/** Categorical levels, lowest first. Fills and strokes are SPC's own, used when a file omits them. */
export const SPC_CATEGORICAL = {
  TSTM: { rank: 1, name: "General thunderstorms", fill: "#c1e9c1", stroke: "#55bb55" },
  MRGL: { rank: 2, name: "Marginal risk", fill: "#66a366", stroke: "#005500" },
  SLGT: { rank: 3, name: "Slight risk", fill: "#ffe066", stroke: "#ddaa00" },
  ENH: { rank: 4, name: "Enhanced risk", fill: "#ffa366", stroke: "#ff6600" },
  MDT: { rank: 5, name: "Moderate risk", fill: "#e06666", stroke: "#cc0000" },
  HIGH: { rank: 6, name: "High risk", fill: "#ee99ee", stroke: "#cc00cc" },
} as const;
export type SpcCategory = keyof typeof SPC_CATEGORICAL;

export type SpcHazard = "tornado" | "hail" | "wind";

/** SPC probability colours ([fill, stroke]) by hazard. The scales differ: 15% is red for tornadoes, yellow for hail and wind. */
const SPC_PROB_COLORS: Record<SpcHazard, Record<number, readonly [string, string]>> = {
  tornado: {
    2: ["#008b00", "#005900"],
    5: ["#8b4726", "#5c2f19"],
    10: ["#ffc800", "#c89600"],
    15: ["#ff0000", "#b40000"],
    30: ["#ff00ff", "#b400b4"],
    45: ["#912cee", "#5f1d9c"],
    60: ["#104e8b", "#0a3159"],
  },
  hail: {
    5: ["#8b4726", "#5c2f19"],
    15: ["#ffc800", "#c89600"],
    30: ["#ff0000", "#b40000"],
    45: ["#ff00ff", "#b400b4"],
    60: ["#912cee", "#5f1d9c"],
  },
  wind: {
    5: ["#8b4726", "#5c2f19"],
    15: ["#ffc800", "#c89600"],
    30: ["#ff0000", "#b40000"],
    45: ["#ff00ff", "#b400b4"],
    60: ["#912cee", "#5f1d9c"],
  },
};

/** The probability contours SPC draws for each hazard, lowest first. */
export const SPC_PROB_STEPS: Record<SpcHazard, readonly number[]> = {
  tornado: [2, 5, 10, 15, 30, 45, 60],
  hail: [5, 15, 30, 45, 60],
  wind: [5, 15, 30, 45, 60],
};

/** SPC's colours for a probability; an unknown step takes the colour of the step below it. */
export function spcProbColors(hazard: SpcHazard, pct: number): { fill: string; stroke: string } {
  const steps = SPC_PROB_STEPS[hazard];
  const step = [...steps].reverse().find((s) => s <= pct) ?? steps[0]!;
  const [fill, stroke] = SPC_PROB_COLORS[hazard][step]!;
  return { fill, stroke };
}

const SPC_SIG_NAME: Record<SpcHazard, string> = {
  tornado: "Significant tornado (EF2 or stronger)",
  hail: "Significant hail (2 in. or larger)",
  wind: "Significant wind (75 mph or stronger)",
};

/** Rank offset that keeps hatched significant areas above every probability. */
export const SPC_SIG_RANK = 100;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback);

/** "202610071300" (SPC's UTC stamp), or the newer `*_ISO` fields. */
function spcTime(p: SpcProps, key: "VALID" | "EXPIRE"): string | null {
  const iso = p[`${key}_ISO`];
  if (typeof iso === "string" && Number.isFinite(Date.parse(iso))) return new Date(iso).toISOString();
  const raw = typeof p[key] === "number" ? String(p[key]) : p[key];
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw.trim());
  if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)).toISOString();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Walks an SPC .lyr GeoJSON file. Times are read from every feature, including
 * the geometry-less placeholder SPC publishes when there is no risk; only
 * non-empty Polygon/MultiPolygon features are handed to `each`.
 */
function walkSpc(raw: unknown, each: (geometry: PolygonalGeometry, p: SpcProps) => OutlookFeature | null): SpcParsed {
  const features = (raw as { features?: unknown } | null)?.features;
  const result: SpcParsed = { features: [], valid: null, expires: null };
  if (!Array.isArray(features)) return result;
  for (const f of features as ({ geometry?: PolygonalGeometry | null; properties?: SpcProps | null } | null)[]) {
    const p = f?.properties ?? {};
    result.valid ??= spcTime(p, "VALID");
    result.expires ??= spcTime(p, "EXPIRE");
    const g = f?.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates) || g.coordinates.length === 0) continue;
    const out = each(g, p);
    if (out) result.features.push(out);
  }
  // Stable sort, lowest first, so higher risk paints on top.
  result.features.sort((a, b) => a.properties.rank - b.properties.rank);
  return result;
}

/** Categorical outlook (`day{1,2,3}otlk_cat.lyr.geojson`): TSTM through HIGH. */
export function parseSpcOutlook(raw: unknown): SpcParsed {
  return walkSpc(raw, (geometry, p) => {
    const label = String(p.LABEL ?? "").trim().toUpperCase();
    if (!(label in SPC_CATEGORICAL)) return null;
    const def = SPC_CATEGORICAL[label as SpcCategory];
    return {
      type: "Feature",
      geometry,
      properties: { label, name: def.name, fill: color(p.fill, def.fill), stroke: color(p.stroke, def.stroke), rank: def.rank },
    };
  });
}

/** "0.10", "10%", "10", 0.1 → 10. Null when it isn't a probability. */
function percentOf(v: unknown): number | null {
  let pct: number | null = null;
  if (typeof v === "number") pct = v > 0 && v < 1 ? v * 100 : v;
  else if (typeof v === "string") {
    const m = /(\d+(?:\.\d+)?)\s*(%)?/.exec(v);
    if (m) {
      const n = Number(m[1]);
      pct = m[2] || !m[1]!.includes(".") || n > 1 ? n : n * 100;
    }
  }
  return pct != null && Number.isFinite(pct) && pct > 0 && pct <= 100 ? Math.round(pct) : null;
}

/**
 * Day 1 probabilistic outlook for one hazard (`day1otlk_{torn,hail,wind}.lyr.geojson`),
 * or, with `significant`, its hatched significant-severe file
 * (`day1otlk_sig{torn,hail,wind}.lyr.geojson`).
 *
 * Probability features get `label` "0.02"…"0.60", `rank` = the percentage and
 * a name like "10% tornado". Significant features get `label` "SIGN" (or SPC's
 * "CIG1"…"CIG3" intensity codes), `significant: true` and a rank above every
 * probability, so they draw last.
 */
export function parseSpcProbOutlook(raw: unknown, hazard: SpcHazard, { significant = false }: { significant?: boolean } = {}): SpcParsed {
  return walkSpc(raw, (geometry, p) => {
    const rawLabel = String(p.LABEL ?? "").trim().toUpperCase();
    const sig = significant || rawLabel === "SIGN" || /^CIG\d$/.test(rawLabel) || /signific/i.test(String(p.LABEL2 ?? ""));
    if (sig) {
      const level = /^CIG(\d)$/.exec(rawLabel)?.[1];
      return {
        type: "Feature",
        geometry,
        properties: {
          label: level ? rawLabel : "SIGN",
          name: SPC_SIG_NAME[hazard],
          fill: color(p.fill, "#000000"),
          stroke: color(p.stroke, "#000000"),
          rank: SPC_SIG_RANK + (level ? Number(level) : (percentOf(rawLabel) ?? 0)),
          significant: true,
        },
      };
    }
    const pct = percentOf(p.LABEL) ?? percentOf(p.LABEL2) ?? percentOf(p.DN);
    if (pct == null) return null;
    const fallback = spcProbColors(hazard, pct);
    return {
      type: "Feature",
      geometry,
      properties: {
        label: (pct / 100).toFixed(2),
        name: `${pct}% ${hazard}`,
        fill: color(p.fill, fallback.fill),
        stroke: color(p.stroke, fallback.stroke),
        rank: pct,
      },
    };
  });
}
