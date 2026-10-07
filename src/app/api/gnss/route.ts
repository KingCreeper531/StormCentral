import type { GnssElements, GnssResponse } from "@/lib/api/types";
import { trackSatellites, visibilityAt, visibilityTimeline, type GnssElementSet, type TrackedSat } from "@/lib/science/gnss";
import { cached } from "@/lib/server/cache";
import { trimOmm } from "@/lib/server/parse";
import { badRequest, errorResponse, jsonResponse, parseLatLon, upstreamJson } from "@/lib/server/upstream";

const GROUPS = [
  ["gps-ops", "GPS"],
  ["glo-ops", "GLONASS"],
  ["galileo", "Galileo"],
  ["beidou", "BeiDou"],
] as const;

/**
 * CelesTrak asks clients not to re-download element sets more than every
 * ~2 h; we hold them 6 h, so the whole user base costs four requests per window.
 */
function loadElements(): Promise<{ meta: GnssElements; sats: TrackedSat[] }> {
  return cached("gnss:omm", 6 * 3_600_000, async () => {
    const results = await Promise.allSettled(
      GROUPS.map(([group]) => upstreamJson(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`, { timeoutMs: 20_000 })),
    );
    const sets = results.flatMap((r, i) => (r.status === "fulfilled" ? trimOmm(r.value, GROUPS[i]![1]) : []));
    if (!sets.length) throw new Error("CelesTrak unavailable");
    return { meta: { fetched: new Date().toISOString(), sets }, sats: trackSatellites(sets as unknown as GnssElementSet[]) };
  });
}

/**
 * GET /api/gnss?lat&lon — GNSS sky geometry (SGP4) for a location: satellites
 * above a 10° mask, DOP, and a 24 h visibility timeline. Computed server-side
 * on a ~25 km / 5-minute grid so the orbital elements and propagator never
 * ship to the browser.
 */
export async function GET(req: Request) {
  const p = parseLatLon(new URL(req.url).searchParams);
  if (!p) return badRequest("lat/lon required");
  const lat = Math.round(p.lat * 4) / 4;
  const lon = Math.round(p.lon * 4) / 4;
  const bucket = Math.floor(Date.now() / 300_000) * 300_000;
  try {
    const data = await cached(`gnss:${lat}:${lon}:${bucket}`, 5 * 60_000, async (): Promise<GnssResponse> => {
      const { meta, sats } = await loadElements();
      const v = visibilityAt(sats, new Date(bucket), lat, lon);
      return {
        elementsFetched: meta.fetched,
        time: bucket,
        count: v.count,
        byConstellation: v.byConstellation,
        sats: v.sats.map((s) => ({ ...s, azimuthDeg: +s.azimuthDeg.toFixed(1), elevationDeg: +s.elevationDeg.toFixed(1) })),
        dop: v.dop,
        timeline: visibilityTimeline(sats, new Date(bucket), 24, lat, lon),
      };
    });
    return jsonResponse(data, 300);
  } catch (err) {
    return errorResponse(err);
  }
}
