/**
 * Model fields for the radar map: a coarse grid of Open-Meteo forecast points
 * over the view, fetched in one multi-location request, then sampled
 * bilinearly for the colour map and the wind particles.
 *
 * Rows are spaced evenly in Web-Mercator Y (like the air-quality grid), so
 * the colour image drapes onto the map without stretching and a particle's
 * Mercator position maps straight onto grid coordinates.
 *
 * Open-Meteo counts every point as one API call (about 600 a minute per IP
 * on the free tier), so the grid is capped and its edges snap outward to
 * whole degrees: small pans and zooms keep using the grid already fetched.
 */
import { getJson, HttpError, qs } from "../api/http";
import { latFromMercatorY, mercatorY, type BBox } from "../geo";
import type { ModelVariable } from "./scales";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** Hours ahead the time slider reaches (plus the current hour). */
export const MODEL_HOURS = 48;
/** Most forecast points in one grid. */
export const MAX_POINTS = 180;
/** Grid spacings tried, finest first (degrees of longitude). */
const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15] as const;
/** The Mercator map (and a sensible grid) stop short of the poles. */
const MAX_LAT = 80;
const DEG = 180 / Math.PI;

export const MODEL_VARIABLES: readonly ModelVariable[] = ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "temperature_2m", "cape", "precipitation", "snowfall"];

export interface GridPlan {
  bbox: BBox;
  cols: number;
  rows: number;
  /** Most spacing between points, in degrees of longitude (and the same distance in Mercator Y). */
  step: number;
}

export interface ModelGrid extends GridPlan {
  /** Epoch ms of each hour, oldest first. */
  times: number[];
  /** Per variable, one array per hour: row-major from the north-west, NaN where missing. */
  values: Record<ModelVariable, Float32Array[]>;
}

const clampLon = (x: number) => Math.max(-180, Math.min(180, x));
const clampLat = (y: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, y));
/** Height of a latitude band in "Mercator degrees" (the same scale as longitude on the map). */
const mercSpan = (south: number, north: number) => (mercatorY(north) - mercatorY(south)) * DEG;

/**
 * The grid for a view: padded by `pad` of its size on each side, at the
 * finest spacing that keeps it within `maxPoints`.
 */
export function planGrid(view: BBox, maxPoints = MAX_POINTS, pad = 0.15): GridPlan {
  let west = clampLon(view.west);
  let east = clampLon(view.east);
  let south = clampLat(view.south);
  let north = clampLat(view.north);
  // Zoomed far out the view runs past the antimeridian or the poles: sample the whole map.
  if (east <= west || north <= south) [west, east, south, north] = [-180, 180, -MAX_LAT, MAX_LAT];
  const padX = (east - west) * pad;
  const padY = (north - south) * pad;
  const area = (east - west + 2 * padX) * mercSpan(clampLat(south - padY), clampLat(north + padY));
  const first = STEPS.findIndex((s) => s * s * maxPoints >= area);
  let plan: GridPlan | null = null;
  for (let i = first < 0 ? STEPS.length - 1 : first; i < STEPS.length; i++) {
    const step = STEPS[i]!;
    const snap = Math.max(1, step);
    const bbox = {
      west: clampLon(Math.floor((west - padX) / snap) * snap),
      east: clampLon(Math.ceil((east + padX) / snap) * snap),
      south: clampLat(Math.floor((south - padY) / snap) * snap),
      north: clampLat(Math.ceil((north + padY) / snap) * snap),
    };
    const cols = Math.max(2, Math.ceil((bbox.east - bbox.west) / step - 1e-9));
    const rows = Math.max(2, Math.ceil(mercSpan(bbox.south, bbox.north) / step - 1e-9));
    plan = { bbox, cols, rows, step };
    if (cols * rows <= maxPoints) return plan;
  }
  // Even the coarsest spacing is too many points (the whole world): thin it evenly.
  const p = plan!;
  const k = Math.sqrt(maxPoints / (p.cols * p.rows));
  return { ...p, cols: Math.max(2, Math.floor(p.cols * k)), rows: Math.max(2, Math.floor(p.rows * k)) };
}

/** Whether `plan`'s grid still serves `view`: it covers it and is at least as fine as a fresh plan would be. */
export function planServes(plan: GridPlan, view: BBox, maxPoints = MAX_POINTS): boolean {
  const fresh = planGrid(view, maxPoints);
  const b = plan.bbox;
  const covered = clampLon(view.west) >= b.west && clampLon(view.east) <= b.east && clampLat(view.south) >= b.south && clampLat(view.north) <= b.north;
  return covered && plan.step <= fresh.step;
}

/** The grid's sample points (cell centres), row-major from the north-west. */
export function gridPoints({ bbox, cols, rows }: GridPlan): { lats: number[]; lons: number[] } {
  const yN = mercatorY(bbox.north);
  const yS = mercatorY(bbox.south);
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = latFromMercatorY(yN + ((yS - yN) * (r + 0.5)) / rows);
    for (let c = 0; c < cols; c++) {
      lats.push(+lat.toFixed(2));
      lons.push(+(bbox.west + ((bbox.east - bbox.west) * (c + 0.5)) / cols).toFixed(2));
    }
  }
  return { lats, lons };
}

export function modelGridUrl(plan: GridPlan, variables: readonly ModelVariable[] = MODEL_VARIABLES): string {
  const { lats, lons } = gridPoints(plan);
  return `${FORECAST_URL}?${qs({
    latitude: lats,
    longitude: lons,
    hourly: variables,
    // Counted from the current hour, so the slider starts at now.
    forecast_hours: MODEL_HOURS + 1,
    wind_speed_unit: "ms",
    timeformat: "unixtime",
    timezone: "GMT",
    // The model's own cell, sea or land: the default moves sea points to the nearest land.
    cell_selection: "nearest",
  })}`;
}

type RawPoint = { hourly?: Record<string, unknown> };

/** Normalise a multi-location response into per-hour grids (pure). */
export function parseModelGrid(input: unknown, plan: GridPlan): ModelGrid {
  const list = (Array.isArray(input) ? input : [input]) as RawPoint[];
  const n = plan.cols * plan.rows;
  const rawTimes = list[0]?.hourly?.time;
  const times = Array.isArray(rawTimes) ? rawTimes.filter((x): x is number => typeof x === "number").map((s) => s * 1000) : [];
  const values = {} as ModelGrid["values"];
  for (const v of MODEL_VARIABLES) values[v] = times.map(() => new Float32Array(n).fill(Number.NaN));
  list.slice(0, n).forEach((p, i) => {
    for (const v of MODEL_VARIABLES) {
      const series = p.hourly?.[v];
      if (!Array.isArray(series)) continue;
      for (let h = 0; h < times.length; h++) {
        const x = series[h];
        if (typeof x === "number") values[v][h]![i] = x;
      }
    }
  });
  return { ...plan, times, values };
}

export async function fetchModelGrid(plan: GridPlan, signal?: AbortSignal): Promise<ModelGrid> {
  let raw: unknown;
  try {
    raw = await getJson(modelGridUrl(plan), { signal, timeoutMs: 25_000 });
  } catch (err) {
    // A 400 means a variable isn't offered there (CAPE on some models): keep the rest.
    if (!(err instanceof HttpError) || err.status !== 400) throw err;
    raw = await getJson(modelGridUrl(plan, MODEL_VARIABLES.filter((v) => v !== "cape")), { signal, timeoutMs: 25_000 });
  }
  return parseModelGrid(raw, plan);
}

/** The hour to show for time `at`: the last one at or before it (the first before the grid starts). */
export function hourIndex(times: readonly number[], at: number): number {
  let i = 0;
  while (i + 1 < times.length && times[i + 1]! <= at) i++;
  return i;
}

/**
 * Bilinear value at a fractional grid position (`fx` columns, `fy` rows from
 * the north-west sample), clamped to the grid's edge. Missing neighbours are
 * left out of the blend; NaN when all four are missing.
 */
export function bilinear(values: Float32Array, cols: number, rows: number, fx: number, fy: number): number {
  const x = Math.max(0, Math.min(cols - 1, fx));
  const y = Math.max(0, Math.min(rows - 1, fy));
  const c0 = Math.floor(x);
  const r0 = Math.floor(y);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tx = x - c0;
  const ty = y - r0;
  // Written out rather than looped: this runs twice per particle per frame.
  const a = values[r0 * cols + c0]!;
  const b = values[r0 * cols + c1]!;
  const c = values[r1 * cols + c0]!;
  const d = values[r1 * cols + c1]!;
  const wa = (1 - tx) * (1 - ty);
  const wb = tx * (1 - ty);
  const wc = (1 - tx) * ty;
  const wd = tx * ty;
  const fa = Number.isFinite(a);
  const fb = Number.isFinite(b);
  const fc = Number.isFinite(c);
  const fd = Number.isFinite(d);
  if (fa && fb && fc && fd) return a * wa + b * wb + c * wc + d * wd;
  const wsum = (fa ? wa : 0) + (fb ? wb : 0) + (fc ? wc : 0) + (fd ? wd : 0);
  // All the weight on missing samples (exactly on one): any neighbour that has a value.
  if (wsum === 0) return fa ? a : fb ? b : fc ? c : fd ? d : Number.NaN;
  return ((fa ? a * wa : 0) + (fb ? b * wb : 0) + (fc ? c * wc : 0) + (fd ? d * wd : 0)) / wsum;
}

/** Wind speed and the direction it blows *from* (meteorological degrees) → east and north components. */
export function windComponents(speed: number, fromDeg: number): [number, number] {
  const r = (fromDeg * Math.PI) / 180;
  return [-speed * Math.sin(r), -speed * Math.cos(r)];
}

/**
 * One hour's wind as east/north components, so interpolating never averages
 * 350° and 10° into a southerly. Positions are longitude and Mercator Y.
 */
export class WindSampler {
  private readonly u: Float32Array;
  private readonly v: Float32Array;
  private readonly yN: number;
  private readonly yS: number;

  constructor(
    private readonly grid: ModelGrid,
    hour: number,
  ) {
    const speed = grid.values.wind_speed_10m[hour];
    const dir = grid.values.wind_direction_10m[hour];
    const n = grid.cols * grid.rows;
    this.u = new Float32Array(n).fill(Number.NaN);
    this.v = new Float32Array(n).fill(Number.NaN);
    for (let i = 0; speed && dir && i < n; i++) {
      if (!Number.isFinite(speed[i]!) || !Number.isFinite(dir[i]!)) continue;
      const [u, v] = windComponents(speed[i]!, dir[i]!);
      this.u[i] = u;
      this.v[i] = v;
    }
    this.yN = mercatorY(grid.bbox.north);
    this.yS = mercatorY(grid.bbox.south);
  }

  /** Wind at (lon, Mercator y) into `out` as [east, north] m/s; false outside the grid or where missing. */
  sample(lon: number, y: number, out: Float64Array): boolean {
    const { bbox, cols, rows } = this.grid;
    if (lon < bbox.west || lon > bbox.east || y > this.yN || y < this.yS) return false;
    const fx = ((lon - bbox.west) / (bbox.east - bbox.west)) * cols - 0.5;
    const fy = ((this.yN - y) / (this.yN - this.yS)) * rows - 0.5;
    const u = bilinear(this.u, cols, rows, fx, fy);
    const v = bilinear(this.v, cols, rows, fx, fy);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
    out[0] = u;
    out[1] = v;
    return true;
  }
}
