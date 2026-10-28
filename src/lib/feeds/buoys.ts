import { parseActiveStations, parseLatestObs, type StationInfo } from "./buoys-parse";
import { cached } from "./cache";
import type { Feed } from "./types";
import { upstreamText } from "./upstream";

/**
 * Marine observations for the radar map from NOAA's National Data Buoy
 * Center (free, public domain): every buoy and coastal station's newest
 * report from latest_obs.txt, named from activestations.xml. Both are plain
 * text without CORS headers, so the phone fetches them natively.
 */

/** A moored buoy (or DART buoy), or a fixed/coastal station (C-MAN, piers, platforms, partners). */
export type BuoyKind = "buoy" | "station";

/** One station's newest observation, in SI like the rest of the app's data (m, s, °, m/s, hPa, °C). */
export interface Buoy {
  /** NDBC station id, upper case ("41001", "ALSN6"). */
  id: string;
  name: string;
  kind: BuoyKind;
  lat: number;
  lon: number;
  /** ISO time of the observation (UTC). */
  time: string;
  /** Significant wave height (m). */
  waveHeight: number | null;
  /** Dominant wave period (s). */
  dominantPeriod: number | null;
  /** Direction the dominant waves come from (° true). */
  waveDir: number | null;
  /** Direction the wind comes from (° true). */
  windDir: number | null;
  /** Wind speed (m/s, NDBC's 8- or 2-minute average). */
  windSpeed: number | null;
  /** Peak gust (m/s). */
  gust: number | null;
  /** Sea-level pressure (hPa). */
  pressure: number | null;
  airTemp: number | null;
  /** Sea surface temperature (°C). */
  waterTemp: number | null;
}

export interface BuoysResponse {
  buoys: Buoy[];
  updated: string;
}

const NDBC = "https://www.ndbc.noaa.gov";

/** Names change rarely: a day's cache. Without them the stations are still shown, named by id. */
const loadStations = () =>
  cached("ndbc:stations", 24 * 3_600_000, async () => parseActiveStations(await upstreamText(`${NDBC}/activestations.xml`, { timeoutMs: 20_000, noCors: true })));

export const buoysFeed: Feed<BuoysResponse> = {
  path: "/api/buoys",
  maxAge: 600,
  async load() {
    // Most stations report hourly, some every 10 minutes; NDBC rewrites the file every few minutes.
    return cached("ndbc:latest", 10 * 60_000, async (): Promise<BuoysResponse> => {
      const [obs, stations] = await Promise.allSettled([
        upstreamText(`${NDBC}/data/latest_obs/latest_obs.txt`, { timeoutMs: 20_000, noCors: true }),
        loadStations(),
      ]);
      if (obs.status === "rejected") throw obs.reason;
      const names = stations.status === "fulfilled" ? stations.value : new Map<string, StationInfo>();
      return { buoys: parseLatestObs(obs.value, names), updated: new Date().toISOString() };
    });
  },
};
