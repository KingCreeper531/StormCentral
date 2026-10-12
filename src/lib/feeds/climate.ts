import { buildClimate, type ClimateTable } from "../climate";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
/** Records are searched from here to the end of last year. */
const RECORDS_FROM = 1951;

export type ClimateResponse = ClimateTable;

/**
 * `lat` & `lon`: normals and daily records for the ERA5 grid cell (~25 km)
 * containing the point. Built from 75 years of daily data (about 700 kB from
 * the archive), so the compact table is cached for a week per grid cell.
 */
export const climateFeed: Feed<ClimateResponse> = {
  path: "/api/climate",
  maxAge: 86_400,
  async load(sp) {
    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    // ERA5's 0.25° grid: everyone in the same cell shares one entry.
    const lat = (Math.round(p.lat * 4) / 4).toFixed(2);
    const lon = (Math.round(p.lon * 4) / 4).toFixed(2);
    const lastYear = new Date().getUTCFullYear() - 1;
    return cached(
      `climate:${lat}:${lon}:${lastYear}`,
      7 * 86_400_000,
      async () => {
        const url =
          `${ARCHIVE}?latitude=${lat}&longitude=${lon}&start_date=${RECORDS_FROM}-01-01&end_date=${lastYear}-12-31` +
          "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&timeformat=iso8601";
        return buildClimate(await upstreamJson(url, { timeoutMs: 45_000 }));
      },
      { persist: true },
    );
  },
};
