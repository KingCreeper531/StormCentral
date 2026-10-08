import type { GnssElements, GnssResponse } from "../api/types";
import { trackSatellites, visibilityAt, visibilityTimeline, type GnssElementSet, type TrackedSat } from "../science/gnss";
import { trimOmm } from "./parse";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

const GROUPS = [
  ["gps-ops", "GPS"],
  ["glo-ops", "GLONASS"],
  ["galileo", "Galileo"],
  ["beidou", "BeiDou"],
] as const;

/**
 * CelesTrak asks clients not to re-download element sets more than every
 * ~2 h. We hold them 6 h: the server costs four requests per window for the
 * whole user base, and a phone keeps them across restarts.
 */
function loadElements(): Promise<GnssElements> {
  return cached(
    "gnss:omm",
    6 * 3_600_000,
    async () => {
      const results = await Promise.allSettled(
        GROUPS.map(([group]) => upstreamJson(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`, { timeoutMs: 20_000 })),
      );
      const sets = results.flatMap((r, i) => (r.status === "fulfilled" ? trimOmm(r.value, GROUPS[i]![1]) : []));
      if (!sets.length) throw new Error("CelesTrak unavailable");
      return { fetched: new Date().toISOString(), sets };
    },
    { persist: true },
  );
}

/** SGP4 initialisation is the expensive part; redo it only when the elements change. */
let tracked: { fetched: string; sats: TrackedSat[] } | null = null;
function satellitesFor(elements: GnssElements) {
  if (tracked?.fetched !== elements.fetched) {
    tracked = { fetched: elements.fetched, sats: trackSatellites(elements.sets as unknown as GnssElementSet[]) };
  }
  return tracked.sats;
}

/**
 * `lat` & `lon`: GNSS sky geometry (SGP4) for a location: satellites above a
 * 10° mask, DOP, and a 24 h visibility timeline, on a ~25 km / 5-minute grid.
 */
export const gnssFeed: Feed<GnssResponse> = {
  path: "/api/gnss",
  maxAge: 300,
  async load(sp) {
    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    const lat = Math.round(p.lat * 4) / 4;
    const lon = Math.round(p.lon * 4) / 4;
    const bucket = Math.floor(Date.now() / 300_000) * 300_000;
    return cached(`gnss:${lat}:${lon}:${bucket}`, 5 * 60_000, async () => {
      const elements = await loadElements();
      const sats = satellitesFor(elements);
      const v = visibilityAt(sats, new Date(bucket), lat, lon);
      return {
        elementsFetched: elements.fetched,
        time: bucket,
        count: v.count,
        byConstellation: v.byConstellation,
        sats: v.sats.map((s) => ({ ...s, azimuthDeg: +s.azimuthDeg.toFixed(1), elevationDeg: +s.elevationDeg.toFixed(1) })),
        dop: v.dop,
        timeline: visibilityTimeline(sats, new Date(bucket), 24, lat, lon),
      };
    });
  },
};
