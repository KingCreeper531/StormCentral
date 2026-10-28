/**
 * Open-Meteo's Marine API (free, no key, CORS-enabled), called from the
 * browser like the other Open-Meteo clients (lib/api/open-meteo): the wave
 * forecast drawn over the sea on the radar map. One multi-location request
 * samples a coarse grid over the view for the next two days, so moving the
 * time slider never refetches. Points on land come back empty and stay clear.
 */
import { latFromMercatorY, mercatorY, type BBox } from "../geo";
import { getJson, qs } from "./http";

const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
/** Hours of forecast the slider covers, from the current hour. */
export const WAVE_HOURS = 48;

export interface WaveGrid {
  bbox: BBox;
  cols: number;
  rows: number;
  /** Cell centres, row-major from north-west. */
  lats: number[];
  lons: number[];
  /** Hour starts (epoch ms), `times.length` ≤ WAVE_HOURS. */
  times: number[];
  /** Per hour, then per cell (`hour * cols * rows + cell`); NaN over land or where missing. */
  height: Float32Array;
  /** Direction the waves come from (° true). */
  direction: Float32Array;
  /** Mean wave period (s). */
  period: Float32Array;
}

/**
 * Cell centres of a `cols`×`rows` grid over the view, spaced evenly in
 * Web-Mercator Y so the drawn image drapes without distortion. The view is
 * clamped to what the API and an image overlay accept.
 */
export function waveGridPoints(view: BBox, cols: number, rows: number): { bbox: BBox; lats: number[]; lons: number[] } {
  let bbox = {
    west: Math.max(-180, Math.min(180, view.west)),
    east: Math.max(-180, Math.min(180, view.east)),
    north: Math.max(-80, Math.min(84, view.north)),
    south: Math.max(-80, Math.min(84, view.south)),
  };
  if (bbox.east <= bbox.west || bbox.north <= bbox.south) bbox = { west: -180, east: 180, north: 84, south: -80 };
  const yN = mercatorY(bbox.north);
  const yS = mercatorY(bbox.south);
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = latFromMercatorY(yN + ((yS - yN) * (r + 0.5)) / rows);
    for (let c = 0; c < cols; c++) {
      lats.push(+lat.toFixed(3));
      lons.push(+(bbox.west + ((bbox.east - bbox.west) * (c + 0.5)) / cols).toFixed(3));
    }
  }
  return { bbox, lats, lons };
}

interface RawLocation {
  hourly?: { time?: number[]; wave_height?: (number | null)[]; wave_direction?: (number | null)[]; wave_period?: (number | null)[] };
}

/** A multi-location marine response (an array; a single location comes as one object) → the grid from the current hour on. */
export function parseWaveGrid(raw: unknown, points: { bbox: BBox; lats: number[]; lons: number[] }, cols: number, rows: number, nowMs = Date.now()): WaveGrid {
  const list = (Array.isArray(raw) ? raw : [raw]) as RawLocation[];
  const cells = cols * rows;
  // Every location shares one time axis (unixtime seconds, from midnight GMT): start at the current hour.
  const axis = list.find((l) => l?.hourly?.time?.length)?.hourly?.time ?? [];
  const hourStart = Math.floor(nowMs / 3_600_000) * 3_600_000;
  let start = axis.findIndex((s) => s * 1000 >= hourStart);
  if (start < 0) start = axis.length;
  const times = axis.slice(start, start + WAVE_HOURS).map((s) => s * 1000);
  const height = new Float32Array(times.length * cells).fill(Number.NaN);
  const direction = new Float32Array(times.length * cells).fill(Number.NaN);
  const period = new Float32Array(times.length * cells).fill(Number.NaN);
  list.slice(0, cells).forEach((loc, i) => {
    const h = loc?.hourly;
    if (!h) return;
    for (let k = 0; k < times.length; k++) {
      const at = k * cells + i;
      const v = h.wave_height?.[start + k];
      // Without a height there's no sea there: leave the cell clear (and arrowless).
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      height[at] = v;
      const d = h.wave_direction?.[start + k];
      const p = h.wave_period?.[start + k];
      if (typeof d === "number" && Number.isFinite(d)) direction[at] = d;
      if (typeof p === "number" && Number.isFinite(p)) period[at] = p;
    }
  });
  return { bbox: points.bbox, cols, rows, lats: points.lats, lons: points.lons, times, height, direction, period };
}

/**
 * The wave forecast on a grid over `view`. Open-Meteo counts each point as an
 * API call (about 600 a minute free per IP), so keep the grid coarse.
 */
export async function fetchWaveGrid(view: BBox, cols = 12, rows = 10, signal?: AbortSignal): Promise<WaveGrid> {
  const points = waveGridPoints(view, cols, rows);
  const raw = await getJson<unknown>(
    `${MARINE_URL}?${qs({
      latitude: points.lats,
      longitude: points.lons,
      hourly: "wave_height,wave_direction,wave_period",
      // Today from midnight GMT plus two more days covers the next 48 hours at any time of day.
      forecast_days: 3,
      timezone: "GMT",
      timeformat: "unixtime",
    })}`,
    { signal, timeoutMs: 25_000 },
  );
  return parseWaveGrid(raw, points, cols, rows);
}

/** One hour of the grid: the cells' height, direction and period. */
export function waveHour(grid: WaveGrid, hour: number): { height: Float32Array; direction: Float32Array; period: Float32Array } {
  const cells = grid.cols * grid.rows;
  const h = Math.max(0, Math.min(grid.times.length - 1, hour));
  const slice = (a: Float32Array) => a.subarray(h * cells, (h + 1) * cells);
  return { height: slice(grid.height), direction: slice(grid.direction), period: slice(grid.period) };
}
