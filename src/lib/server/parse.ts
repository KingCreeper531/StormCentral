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

const SPC_ORDER: Record<string, number> = { TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };

export function parseSpcOutlook(raw: unknown): { features: OutlookFeature[]; valid: string | null } {
  const features = (raw as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return { features: [], valid: null };
  let valid: string | null = null;
  const out: OutlookFeature[] = [];
  for (const f of features as { geometry?: PolygonalGeometry | null; properties?: Record<string, unknown> }[]) {
    const g = f.geometry;
    const p = f.properties ?? {};
    const label = String(p.LABEL ?? "");
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !(label in SPC_ORDER)) continue;
    valid ??= typeof p.VALID === "string" ? p.VALID : null;
    out.push({
      type: "Feature",
      geometry: g,
      properties: {
        label,
        name: String(p.LABEL2 ?? label),
        fill: String(p.fill ?? "#888888"),
        stroke: String(p.stroke ?? "#888888"),
        rank: SPC_ORDER[label]!,
      },
    });
  }
  return { features: out.sort((a, b) => a.properties.rank - b.properties.rank), valid };
}
