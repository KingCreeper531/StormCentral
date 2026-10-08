/**
 * Future radar: HRRR model simulated reflectivity from IEM's tile cache.
 * Layer `hrrr::REFD-F{minutes}-{init}` is the forecast `minutes` (4 digits,
 * every 15) after model run `init` (YYYYMMDDHHmm, UTC). IEM starts processing
 * a run at :40 past the following hour and finishes ~10 minutes later, so a
 * run is safely available two hours after its start.
 * https://mesonet.agron.iastate.edu/GIS/model.phtml
 */
import { compactUtc, IEM_TILE_ROOT, type RadarFrame } from "./frames";

const HOUR = 3_600_000;
const STEP_MIN = 15;
/** IEM serves HRRR to forecast hour 18. */
const MAX_FORECAST_MIN = 18 * 60;
/** How long after its start a run is reliably on IEM. */
export const HRRR_LATENCY_MS = 2 * HOUR;

/** Start of the newest HRRR run IEM has finished processing. */
export function hrrrInit(now: number): number {
  return Math.floor((now - HRRR_LATENCY_MS) / HOUR) * HOUR;
}

export function hrrrTileUrl(init: number, forecastMin: number): string {
  return `${IEM_TILE_ROOT}/hrrr::REFD-F${String(forecastMin).padStart(4, "0")}-${compactUtc(new Date(init))}/{z}/{x}/{y}.png`;
}

/**
 * Forecast frames from just after `after` (the last observed scan) to
 * `hours` ahead of `now`, every `everyMin` minutes, on the 15-minute grid.
 */
export function hrrrFrames(after: number, now: number, hours: number, everyMin = 30): RadarFrame[] {
  if (hours <= 0) return [];
  const init = hrrrInit(now);
  const step = Math.max(STEP_MIN, Math.round(everyMin / STEP_MIN) * STEP_MIN) * 60_000;
  const end = Math.min(now + hours * HOUR, init + MAX_FORECAST_MIN * 60_000);
  const frames: RadarFrame[] = [];
  for (let t = Math.ceil((Math.max(after, now) + 1) / step) * step; t <= end; t += step) {
    const minutes = Math.round((t - init) / 60_000);
    if (minutes < 0 || minutes % STEP_MIN) continue;
    frames.push({ id: `hrrr-${compactUtc(new Date(init))}-${minutes}`, time: t, tileUrl: hrrrTileUrl(init, minutes), maxzoom: 8, forecast: true });
  }
  return frames;
}
