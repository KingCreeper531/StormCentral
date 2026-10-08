/**
 * NWS warnings carry a machine-readable storm motion line, e.g.
 *   "2024-05-21T21:47:00-00:00...storm...239DEG...36KT...4153 9178 4136 9213"
 * (direction the storm moves FROM, speed in knots, LAT LON pairs in
 * hundredths of a degree with west longitude positive). We turn it into a
 * projected track and an ETA for the user's location.
 */
import type { StormMotion } from "../api/types";
import { haversineKm, type LatLon } from "../geo";

const RE = /^(\S+?)\.\.\.[^.]+\.\.\.(\d{1,3})DEG\.\.\.(\d{1,3})KT\.\.\.([\d\s]+)$/;

export function parseEventMotion(text: string | null | undefined): StormMotion | null {
  if (!text) return null;
  const m = RE.exec(text.trim());
  if (!m) return null;
  const nums = m[4]!.trim().split(/\s+/).map(Number);
  const positions: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const lat = nums[i]! / 100;
    let lon = nums[i + 1]! / 100;
    // Longitudes are west-positive; values > 180 encode the far-west Pacific.
    lon = lon > 180 ? 360 - lon : -lon;
    positions.push([lon, lat]);
  }
  if (!positions.length) return null;
  return {
    time: m[1]!,
    headingDeg: (Number(m[2]) + 180) % 360,
    speedKt: Number(m[3]),
    positions,
  };
}

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Destination point along a great circle. */
export function destination(p: LatLon, bearingDeg: number, distKm: number): LatLon {
  const δ = distKm / R_KM;
  const θ = bearingDeg * RAD;
  const φ1 = p.lat * RAD;
  const λ1 = p.lon * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 / RAD, lon: ((λ2 / RAD + 540) % 360) - 180 };
}

/** Positions after `minutes` (one entry per reference point). */
export function projectTrack(motion: StormMotion, minutes: number[]): { minutes: number; points: LatLon[] }[] {
  const kmPerMin = (motion.speedKt * 1.852) / 60;
  const elapsed = Math.max(0, (Date.now() - Date.parse(motion.time)) / 60_000);
  return minutes.map((min) => ({
    minutes: min,
    points: motion.positions.map(([lon, lat]) =>
      destination({ lat, lon }, motion.headingDeg, kmPerMin * (min + (Number.isFinite(elapsed) ? elapsed : 0))),
    ),
  }));
}

/**
 * Minutes until the storm reaches `p` (null if it's moving away or will pass
 * more than `corridorKm` to either side).
 */
export function stormEta(motion: StormMotion, p: LatLon, corridorKm = 15, now = Date.now()): number | null {
  if (motion.speedKt <= 0) return null;
  const kmPerMin = (motion.speedKt * 1.852) / 60;
  const elapsed = Math.max(0, (now - Date.parse(motion.time)) / 60_000) || 0;
  let best: number | null = null;
  for (const [lon, lat] of motion.positions) {
    const start = destination({ lat, lon }, motion.headingDeg, kmPerMin * elapsed);
    const d = haversineKm(start, p);
    const brg = bearing(start, p);
    const off = ((brg - motion.headingDeg + 540) % 360) - 180;
    const along = d * Math.cos(off * RAD);
    const cross = Math.abs(d * Math.sin(off * RAD));
    if (along < 0 || cross > corridorKm) continue;
    const eta = along / kmPerMin;
    if (best === null || eta < best) best = eta;
  }
  return best;
}

function bearing(a: LatLon, b: LatLon) {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
