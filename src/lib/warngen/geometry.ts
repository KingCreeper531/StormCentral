/**
 * WarnGen polygon geometry: the default polygon drawn from a storm's position
 * and motion (the "drag me to storm" box widening down the track, like
 * AWIPS WarnGen's), and the checks a polygon must pass before it's issued.
 *
 * Rings are closed `[lon, lat]` arrays (first vertex repeated at the end).
 */
import type { LatLon } from "../geo";
import { destination } from "../pro/storm-tools";

export type Ring = [number, number][];

const KM_PER_NM = 1.852;
const R_EARTH_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Round to 0.01° (the precision of a warning's LAT...LON line), closing the ring. */
export function closeRing(points: readonly [number, number][]): Ring {
  const out: Ring = points.map(([lon, lat]) => [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]);
  // Drop consecutive duplicates that rounding can create.
  const dedup = out.filter((p, i) => i === 0 || p[0] !== out[i - 1]![0] || p[1] !== out[i - 1]![1]);
  const first = dedup[0];
  const last = dedup.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) dedup.push([first[0], first[1]]);
  return dedup;
}

/** The ring's distinct vertices (without the closing repeat). */
export const openRing = (ring: Ring): Ring => (ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring.slice());

export interface TrackOptions {
  /** Half-width of the polygon at the storm (km). */
  startHalfWidthKm?: number;
  /** How far behind the storm the polygon starts (km). */
  backKm?: number;
  /** Extra length past the projected end position (km). */
  frontKm?: number;
  /** Spread either side of the track (deg) that widens the far end. */
  spreadDeg?: number;
}

/**
 * The default warning polygon. A moving storm gets a four-sided box that
 * starts just behind it and widens along its projected track; a stationary
 * one (or a speed under 3 kt) gets an octagon around it.
 */
export function trackPolygon(storm: LatLon, motion: { headingDeg: number; speedKt: number } | null, minutes: number, opts: TrackOptions = {}): Ring {
  const w0 = opts.startHalfWidthKm ?? 7;
  if (!motion || motion.speedKt < 3) {
    const r = Math.max(10, w0 * 1.8);
    return closeRing(Array.from({ length: 8 }, (_, i) => {
      const p = destination(storm, i * 45 + 22.5, r);
      return [p.lon, p.lat] as [number, number];
    }));
  }
  const h = motion.headingDeg;
  const lengthKm = (motion.speedKt * KM_PER_NM * minutes) / 60;
  const back = destination(storm, h + 180, opts.backKm ?? 4);
  const front = destination(storm, h, lengthKm + (opts.frontKm ?? 4));
  const w1 = w0 + Math.tan(toRad(opts.spreadDeg ?? 14)) * lengthKm;
  const pts = [destination(back, h - 90, w0), destination(front, h - 90, w1), destination(front, h + 90, w1), destination(back, h + 90, w0)];
  return closeRing(pts.map((p) => [p.lon, p.lat] as [number, number]));
}

/** Spherical-excess-free area: equal-area projection about the ring's mean latitude (fine at storm scale). */
export function ringAreaKm2(ring: Ring): number {
  const pts = openRing(ring);
  if (pts.length < 3) return 0;
  const lat0 = toRad(pts.reduce((s, p) => s + p[1], 0) / pts.length);
  const xy = pts.map(([lon, lat]) => [toRad(lon) * Math.cos(lat0) * R_EARTH_KM, toRad(lat) * R_EARTH_KM] as const);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i]!;
    const [x2, y2] = xy[(i + 1) % xy.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const cross = (o: readonly number[], a: readonly number[], b: readonly number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);

function segmentsCross(p1: readonly number[], p2: readonly number[], q1: readonly number[], q2: readonly number[]): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when two non-adjacent edges cross (a bow-tie polygon). */
export function selfIntersects(ring: Ring): boolean {
  const pts = openRing(ring);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** Move vertex `i` (of the open ring) and return the closed ring. */
export function moveVertex(ring: Ring, i: number, to: [number, number]): Ring {
  const pts = openRing(ring);
  if (i < 0 || i >= pts.length) return ring;
  pts[i] = to;
  return closeRing(pts);
}

/** Insert a vertex after `i` (of the open ring). */
export function insertVertex(ring: Ring, i: number, at: [number, number]): Ring {
  const pts = openRing(ring);
  pts.splice(i + 1, 0, at);
  return closeRing(pts);
}

/** Remove vertex `i` (of the open ring), keeping at least a triangle. */
export function removeVertex(ring: Ring, i: number): Ring {
  const pts = openRing(ring);
  if (pts.length <= 3) return ring;
  pts.splice(i, 1);
  return closeRing(pts);
}

/** Midpoints of each edge, for the "drag to add a corner" handles. */
export function edgeMidpoints(ring: Ring): [number, number][] {
  const pts = openRing(ring);
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  });
}

/** NWS "LAT...LON 3521 9744 ..." line: hundredths of a degree, west longitude positive, without the closing vertex. */
export function latLonLine(ring: Ring): string {
  const parts = openRing(ring).map(([lon, lat]) => `${Math.round(lat * 100)} ${Math.round(Math.abs(lon) * 100)}`);
  const lines: string[] = [];
  let cur = "LAT...LON";
  for (const p of parts) {
    if (cur.length + p.length + 1 > 66) {
      lines.push(cur);
      cur = "     ";
    }
    cur += ` ${p}`;
  }
  lines.push(cur);
  return lines.join("\n");
}

export function ringBounds(ring: Ring): [number, number, number, number] {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
