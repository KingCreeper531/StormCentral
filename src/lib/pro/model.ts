/**
 * Model (NWP) profiles for Professional mode, from Open-Meteo: the forecast
 * for the current hour on pressure levels plus the surface, turned into a
 * Sounding for the Skew-T, the cursor readout and the cross-section.
 *
 * Open-Meteo blends the best regional models for each location (HRRR and
 * NAM in the US, GFS elsewhere) and serves them already decoded from GRIB2,
 * so the browser never touches a GRIB file. Called straight from the browser
 * like the rest of the app's Open-Meteo traffic.
 */
import type { LatLon } from "../geo";
import { getJson, qs } from "../api/http";
import { analyze, windComponents, type Level, type Sounding, type SoundingIndices } from "./thermo";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** The pressure levels every model on Open-Meteo carries. */
export const PROFILE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100] as const;
const LEVEL_FIELDS = ["temperature", "dew_point", "geopotential_height", "wind_speed", "wind_direction"] as const;
const SURFACE_FIELDS = ["temperature_2m", "dew_point_2m", "surface_pressure", "wind_speed_10m", "wind_direction_10m", "cape", "convective_inhibition"] as const;

const HOURLY = [...SURFACE_FIELDS, ...PROFILE_LEVELS.flatMap((p) => LEVEL_FIELDS.map((f) => `${f}_${p}hPa`))].join(",");

type Series = (number | null)[];

export interface OpenMeteoProfile {
  latitude: number;
  longitude: number;
  /** Ground height at the requested point (90 m DEM), m. */
  elevation: number;
  hourly: { time: string[] } & Record<string, Series | string[]>;
}

/** One request for the current hour's profile at up to ~50 points (multi-point answers come back as an array). */
export function profileUrl(points: readonly LatLon[]): string {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return `${FORECAST_URL}?${qs({
    latitude: points.map((p) => r(p.lat)),
    longitude: points.map((p) => r(p.lon)),
    hourly: HOURLY,
    wind_speed_unit: "ms",
    forecast_hours: 1,
    timezone: "GMT",
  })}`;
}

export interface ModelPoint {
  lat: number;
  lon: number;
  elevation: number;
  /** Model valid time, epoch ms. */
  valid: number;
  sfc: { t: number | null; td: number | null; p: number | null; cape: number | null; cin: number | null };
  /** Surface-up profile; null when the model left too few levels above ground. */
  sounding: Sounding | null;
}

const num = (s: Series | string[] | undefined, i: number): number | null => {
  const v = s?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * Surface-up profile from one Open-Meteo location: the 2 m / 10 m surface
 * observation first, then every pressure level above the ground (levels
 * "below ground" in mountains are model extrapolations and are dropped).
 */
export function parseProfile(d: OpenMeteoProfile, i = 0): ModelPoint {
  const h = d.hourly;
  const sfc = {
    t: num(h.temperature_2m, i),
    td: num(h.dew_point_2m, i),
    p: num(h.surface_pressure, i),
    cape: num(h.cape, i),
    cin: num(h.convective_inhibition, i),
  };
  const valid = Date.parse(`${h.time[i] ?? ""}Z`);
  const levels: Level[] = [];
  if (sfc.t != null && sfc.td != null && sfc.p != null) {
    const w = windComponents(num(h.wind_speed_10m, i) ?? 0, num(h.wind_direction_10m, i) ?? 0);
    levels.push({ p: sfc.p, z: d.elevation, t: sfc.t, td: Math.min(sfc.td, sfc.t), ...w });
  }
  for (const p of PROFILE_LEVELS) {
    const t = num(h[`temperature_${p}hPa`], i);
    const td = num(h[`dew_point_${p}hPa`], i);
    const z = num(h[`geopotential_height_${p}hPa`], i);
    const spd = num(h[`wind_speed_${p}hPa`], i);
    const dir = num(h[`wind_direction_${p}hPa`], i);
    if (t == null || td == null || z == null || spd == null || dir == null) continue;
    const below = levels.at(-1);
    // Keep the profile strictly ascending (and above the ground).
    if (below && (p >= below.p - 1 || z <= below.z + 5)) continue;
    levels.push({ p, z, t, td: Math.min(td, t), ...windComponents(spd, dir) });
  }
  return {
    lat: d.latitude,
    lon: d.longitude,
    elevation: d.elevation,
    valid: Number.isFinite(valid) ? valid : Date.now(),
    sfc,
    sounding: levels.length >= 6 && levels[0]!.z === d.elevation ? { levels, sfcZ: d.elevation } : null,
  };
}

// ── Point profiles with a small cache (cursor readout, sounding clicks) ─────

const TTL_MS = 15 * 60_000;
const CACHE_SIZE = 64;
const cache = new Map<string, { at: number; p: Promise<ModelPoint> }>();
/** ~2 km: closer than any model's grid, so neighbouring hovers share a request. */
const key = (p: LatLon) => `${Math.round(p.lat * 50) / 50},${Math.round(p.lon * 50) / 50}`;

export function modelPoint(p: LatLon, signal?: AbortSignal): Promise<ModelPoint> {
  const k = key(p);
  let hit = cache.get(k);
  if (!hit || Date.now() - hit.at >= TTL_MS) {
    const [lat, lon] = k.split(",").map(Number) as [number, number];
    // Shared by every caller, so no one caller's abort fails it for the others: each gives up on its own below.
    const req = getJson<OpenMeteoProfile>(profileUrl([{ lat, lon }]), { timeoutMs: 12_000 }).then((d) => parseProfile(d));
    hit = { at: Date.now(), p: req };
    cache.set(k, hit);
    req.catch(() => cache.delete(k));
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return signal ? untilAborted(hit.p, signal) : hit.p;
}

/** `p`, or a rejection as soon as `signal` aborts. */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** The cursor readout's NWP fields. */
export interface ModelReadout {
  t: number | null;
  td: number | null;
  cape: number | null;
  cin: number | null;
  /** 0–3 km bulk shear, kt. */
  shear03: number | null;
  /** Precipitable water, mm. */
  pwat: number | null;
  elevation: number;
  valid: number;
}

export function readoutFrom(m: ModelPoint, indices?: SoundingIndices | null): ModelReadout {
  const a = indices ?? (m.sounding ? analyze(m.sounding) : null);
  return {
    t: m.sfc.t,
    td: m.sfc.td,
    cape: m.sfc.cape,
    cin: m.sfc.cin,
    shear03: a?.shear03 != null ? a.shear03 * 1.943844 : null,
    pwat: a?.pwat ?? null,
    elevation: m.elevation,
    valid: m.valid,
  };
}

// ── Cross-section ───────────────────────────────────────────────────────────

/** `n` evenly spaced points from a to b (straight in lat/lon, fine at section scales). */
export function transect(a: LatLon, b: LatLon, n: number): LatLon[] {
  return Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 0 : i / (n - 1);
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
  });
}

export async function crossSection(a: LatLon, b: LatLon, n = 24, signal?: AbortSignal): Promise<ModelPoint[]> {
  const pts = transect(a, b, n);
  const res = await getJson<OpenMeteoProfile | OpenMeteoProfile[]>(profileUrl(pts), { signal, timeoutMs: 20_000 });
  return (Array.isArray(res) ? res : [res]).map((d) => parseProfile(d));
}
