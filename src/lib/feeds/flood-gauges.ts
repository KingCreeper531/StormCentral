import { haversineKm, type LatLon } from "../geo";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

/**
 * NOAA National Water Prediction Service (water.noaa.gov) river gauges: the
 * official stage, flood category and forecast crest at each forecast point,
 * with the action / minor / moderate / major flood stages.
 */
const NWPS = "https://api.water.noaa.gov/nwps/v1";

/** NWS flood categories, in rising order. */
export const FLOOD_CATEGORIES = ["none", "action", "minor", "moderate", "major"] as const;
export type FloodCategory = (typeof FLOOD_CATEGORIES)[number];

export interface GaugeReading {
  value: number;
  unit: string;
  category: FloodCategory;
  time: string;
}

export interface FloodStages {
  action: number | null;
  minor: number | null;
  moderate: number | null;
  major: number | null;
}

export interface FloodGauge {
  /** NWS location id, e.g. "PTTP1" (water.noaa.gov/gauges/<lid>). */
  lid: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  observed: GaugeReading | null;
  /** The forecast crest/value at the end of the forecast, where the NWS issues one. */
  forecast: GaugeReading | null;
  /** Flood stages in `stageUnit` (usually ft), when the gauge has them. */
  stages: FloodStages | null;
  stageUnit: string | null;
}

export interface FloodGaugesResponse {
  gauges: FloodGauge[];
  /** Gauges in range that are reporting (before the list is trimmed). */
  total: number;
  /** How many of those are at or above flood stage right now. */
  flooding: number;
}

interface RawReading {
  primary?: number;
  primaryUnit?: string;
  secondary?: number;
  secondaryUnit?: string;
  floodCategory?: string;
  validTime?: string;
}

interface RawGauge {
  lid?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  status?: { observed?: RawReading; forecast?: RawReading };
  flood?: { stageUnits?: string; categories?: Partial<Record<"action" | "minor" | "moderate" | "major", { stage?: number }>> };
}

const CATEGORY_MAP: Record<string, FloodCategory> = {
  no_flooding: "none",
  // Gauges without defined flood stages still report a valid level.
  not_defined: "none",
  low_threshold: "none",
  action: "action",
  minor: "minor",
  moderate: "moderate",
  major: "major",
};

export const floodRank = (c: FloodCategory | undefined | null) => (c ? FLOOD_CATEGORIES.indexOf(c) : 0);

const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > -900;

/**
 * One NWPS reading, or null when the gauge is out of service, stale or has no
 * value (NWPS marks those with -999 and a 0001-01-01 time). Stage in feet is
 * preferred, whichever of primary/secondary carries it.
 */
export function parseReading(r: RawReading | undefined): GaugeReading | null {
  if (!r) return null;
  const category = CATEGORY_MAP[r.floodCategory ?? ""];
  if (!category || !r.validTime || r.validTime.startsWith("0001")) return null;
  const pick =
    r.primaryUnit === "ft" && valid(r.primary)
      ? { value: r.primary, unit: "ft" }
      : r.secondaryUnit === "ft" && valid(r.secondary)
        ? { value: r.secondary, unit: "ft" }
        : valid(r.primary) && r.primaryUnit
          ? { value: r.primary, unit: r.primaryUnit }
          : null;
  return pick ? { ...pick, category, time: r.validTime } : null;
}

export function parseStages(g: RawGauge): { stages: FloodStages | null; stageUnit: string | null } {
  const c = g.flood?.categories;
  if (!c) return { stages: null, stageUnit: null };
  const s = (k: keyof FloodStages) => (valid(c[k]?.stage) && c[k]!.stage! > 0 ? c[k]!.stage! : null);
  const stages = { action: s("action"), minor: s("minor"), moderate: s("moderate"), major: s("major") };
  const any = Object.values(stages).some((v) => v != null);
  return { stages: any ? stages : null, stageUnit: any ? (g.flood?.stageUnits ?? "ft") : null };
}

/** Reporting gauges within `radiusKm`, worst flooding first, then nearest. */
export function parseGaugeList(raw: unknown, p: LatLon, radiusKm: number): FloodGauge[] {
  const list = (raw as { gauges?: RawGauge[] })?.gauges;
  if (!Array.isArray(list)) return [];
  const out: FloodGauge[] = [];
  for (const g of list) {
    if (!g.lid || typeof g.latitude !== "number" || typeof g.longitude !== "number") continue;
    const observed = parseReading(g.status?.observed);
    if (!observed) continue;
    const distanceKm = haversineKm(p, { lat: g.latitude, lon: g.longitude });
    if (distanceKm > radiusKm) continue;
    out.push({
      lid: g.lid,
      name: g.name?.trim() || g.lid,
      lat: g.latitude,
      lon: g.longitude,
      distanceKm,
      observed,
      forecast: parseReading(g.status?.forecast),
      stages: null,
      stageUnit: null,
    });
  }
  const worst = (g: FloodGauge) => Math.max(floodRank(g.observed?.category), floodRank(g.forecast?.category));
  return out.sort((a, b) => worst(b) - worst(a) || a.distanceKm - b.distanceKm);
}

const MAX_GAUGES = 6;

/** `lat` & `lon` (optional `radiusKm`, 10–150): nearby NWS river forecast points with flood stages. */
export const floodGaugesFeed: Feed<FloodGaugesResponse> = {
  path: "/api/flood-gauges",
  maxAge: 600,
  async load(sp) {
    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    const lat = Math.round(p.lat * 10) / 10;
    const lon = Math.round(p.lon * 10) / 10;
    const radiusKm = Math.round(Math.min(150, Math.max(10, Number(sp.get("radiusKm")) || 60)));
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    return cached(`flood-gauges:${lat}:${lon}:${radiusKm}`, 10 * 60_000, async () => {
      const q = `bbox.xmin=${(lon - dLon).toFixed(3)}&bbox.ymin=${(lat - dLat).toFixed(3)}&bbox.xmax=${(lon + dLon).toFixed(3)}&bbox.ymax=${(lat + dLat).toFixed(3)}&srid=EPSG_4326`;
      // Distances from the cache cell's centre, so every user sharing the entry sees the same list.
      const all = parseGaugeList(await upstreamJson(`${NWPS}/gauges?${q}`, { timeoutMs: 20_000 }), { lat, lon }, radiusKm);
      const gauges = all.slice(0, MAX_GAUGES);
      // Flood stages live on each gauge's own record; they rarely change.
      await Promise.all(
        gauges.map(async (g) => {
          try {
            const stages = await cached(
              `flood-stages:${g.lid}`,
              12 * 3_600_000,
              async () => parseStages(await upstreamJson<RawGauge>(`${NWPS}/gauges/${encodeURIComponent(g.lid)}`)),
              { persist: true },
            );
            Object.assign(g, stages);
          } catch {
            /* the level and category still show without the stage ladder */
          }
        }),
      );
      return { gauges, total: all.length, flooding: all.filter((g) => floodRank(g.observed?.category) >= floodRank("minor")).length };
    });
  },
};
