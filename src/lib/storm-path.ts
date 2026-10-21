/**
 * A warned storm's path, the way storm-tracking apps draw it: where it is now,
 * a centre line an hour ahead with clock times every 15 minutes, a cone that
 * widens with the uncertainty, and the towns inside the cone with the time it
 * reaches each. Everything comes from the warning's own motion line
 * (science/storm-motion), moved on from its issue time to now.
 */
import type { StormMotion } from "./api/types";
import { bearingDeg, destination, haversineKm, type LatLon } from "./geo";

/** How far ahead the path goes. */
export const PATH_MINUTES = 60;
/** Marks along the centre line. */
export const PATH_MARK_MINUTES = [15, 30, 45, 60];
/** The cone: this wide either side at the storm, plus this share of the distance travelled (about ±11°). */
const START_HALF_KM = 1.5;
const SPREAD = 0.2;
/** Slower than this, a storm has no meaningful path. */
export const MIN_PATH_KT = 3;

const RAD = Math.PI / 180;
const kmPerMin = (m: StormMotion) => (m.speedKt * 1.852) / 60;
export const coneHalfKm = (alongKm: number) => START_HALF_KM + Math.max(0, alongKm) * SPREAD;

/** Where each of the warning's reference points is now (moved on from its time, at most an hour). */
export function stormNow(m: StormMotion, now: number): LatLon[] {
  const elapsed = Math.min(60, Math.max(0, (now - Date.parse(m.time)) / 60_000) || 0);
  return m.positions.map(([lon, lat]) => destination({ lat, lon }, m.headingDeg, kmPerMin(m) * elapsed));
}

export interface StormPath {
  /** Centre line from now to the end, [lon, lat]. */
  line: [number, number][];
  /** The cone around it, a closed ring. */
  cone: [number, number][];
  /** The storm now (minutes 0) and every 15 minutes along the line, with the time it gets there. */
  marks: { minutes: number; at: number; lat: number; lon: number }[];
}

/**
 * One path per reference point (a line of storms has several), or none when
 * the storm is barely moving. `until` (epoch ms) ends the path early, at the
 * warning's expiry for example.
 */
export function stormPaths(m: StormMotion, now: number, until = Infinity): StormPath[] {
  if (m.speedKt < MIN_PATH_KT) return [];
  const minutes = Math.min(PATH_MINUTES, Math.max(0, (until - now) / 60_000));
  if (minutes < 5) return [];
  const v = kmPerMin(m);
  const left = (m.headingDeg + 270) % 360;
  const right = (m.headingDeg + 90) % 360;
  // Enough steps that the cone's sides and the line follow the curve of the earth.
  const steps = Array.from({ length: 13 }, (_, i) => (minutes * i) / 12);
  return stormNow(m, now).map((start) => {
    const at = (min: number) => destination(start, m.headingDeg, v * min);
    const centre = steps.map(at);
    const side = (deg: number) => centre.map((p, i) => destination(p, deg, coneHalfKm(v * steps[i]!)));
    const ring = [...side(left), ...side(right).reverse()].map((p): [number, number] => [p.lon, p.lat]);
    ring.push(ring[0]!);
    const marks = [0, ...PATH_MARK_MINUTES.filter((x) => x <= minutes + 0.5)].map((min) => ({ minutes: min, at: now + min * 60_000, ...at(min) }));
    return { line: centre.map((p) => [p.lon, p.lat]), cone: ring, marks };
  });
}

export interface PathPlace extends LatLon {
  name: string;
  /** Bigger first when callouts compete for room: 0 city, 1 town, 2 village. */
  size: number;
}

export interface PathTown extends PathPlace {
  /** Minutes until the storm gets there (from now). */
  minutes: number;
  /** Epoch ms of arrival. */
  at: number;
}

/**
 * Towns inside the cone within the path's hour, soonest first. A town reached
 * by more than one of the storm's reference points counts once, at the first.
 */
export function townsInPath(m: StormMotion, places: readonly PathPlace[], now: number, until = Infinity): PathTown[] {
  if (m.speedKt < MIN_PATH_KT) return [];
  const minutes = Math.min(PATH_MINUTES, Math.max(0, (until - now) / 60_000));
  const v = kmPerMin(m);
  const starts = stormNow(m, now);
  const best = new Map<string, PathTown>();
  for (const p of places) {
    for (const s of starts) {
      const d = haversineKm(s, p);
      if (d > v * minutes + 20) continue;
      const off = ((bearingDeg(s, p) - m.headingDeg + 540) % 360) - 180;
      const along = d * Math.cos(off * RAD);
      const cross = Math.abs(d * Math.sin(off * RAD));
      if (along < 0 || cross > coneHalfKm(along)) continue;
      const min = along / v;
      if (min > minutes) continue;
      const key = `${p.name}|${p.lat.toFixed(2)}|${p.lon.toFixed(2)}`;
      const prev = best.get(key);
      if (!prev || min < prev.minutes) best.set(key, { ...p, minutes: min, at: now + min * 60_000 });
    }
  }
  return [...best.values()].sort((a, b) => a.minutes - b.minutes || a.size - b.size);
}
