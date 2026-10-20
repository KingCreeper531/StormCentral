/**
 * Storm-tracking geometry for Professional mode: the storm vector from two
 * centroid clicks at two loop times, the time-of-arrival (TOA) fan projected
 * along it, and arrival estimates for points of interest.
 *
 * Distances are great-circle; along/cross-track decomposition uses a local
 * flat-earth frame around the storm, which is accurate to well under 1% over
 * the 100–200 km a one-hour fan covers.
 */
import { bearingDeg, destination, haversineKm, type LatLon } from "../geo";

const KM_PER_NM = 1.852;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface TimedPoint extends LatLon {
  /** Epoch ms of the loop frame the point was picked on. */
  t: number;
}

export interface Motion {
  /** Direction of travel (toward), degrees clockwise from north. */
  headingDeg: number;
  speedKt: number;
  /** Where the storm was at the later pick, and when. */
  origin: TimedPoint;
}

/**
 * Motion from two picks of the same storm at different loop times (order
 * doesn't matter). Null when the picks share a time or the storm barely moved
 * (under 1 km, i.e. within the click's own uncertainty).
 */
export function stormMotion(a: TimedPoint, b: TimedPoint): Motion | null {
  const [p, q] = a.t <= b.t ? [a, b] : [b, a];
  const hours = (q.t - p.t) / 3_600_000;
  const km = haversineKm(p, q);
  if (hours <= 0 || km < 1) return null;
  return { headingDeg: bearingDeg(p, q), speedKt: km / KM_PER_NM / hours, origin: q };
}

/** Motion "from" in the meteorological convention (the direction it comes from). */
export const motionFrom = (m: Pick<Motion, "headingDeg">) => (m.headingDeg + 180) % 360;

export const FAN_MINUTES = [15, 30, 45, 60] as const;

export interface ToaFan {
  /** Closed ring [lon, lat] of the whole fan out to the last arc. */
  ring: [number, number][];
  /** One arc per isochrone, for drawing and labelling. */
  arcs: { minutes: number; coords: [number, number][]; label: LatLon }[];
  /** The centre line, origin to the last arc. */
  axis: [number, number][];
}

/**
 * The time-of-arrival fan: the storm's projected position after each of
 * `minutes`, spread ±`spreadDeg` either side of its heading to cover the
 * track's uncertainty (AWIPS's default is ±20°).
 */
export function toaFan(m: Motion, spreadDeg = 20, minutes: readonly number[] = FAN_MINUTES, steps = 16): ToaFan {
  const kmPerMin = (m.speedKt * KM_PER_NM) / 60;
  const arc = (mins: number) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const d = destination(m.origin, m.headingDeg - spreadDeg + (2 * spreadDeg * i) / steps, kmPerMin * mins);
      return [d.lon, d.lat] as [number, number];
    });
  const arcs = minutes.map((mins) => ({ minutes: mins, coords: arc(mins), label: destination(m.origin, m.headingDeg + spreadDeg, kmPerMin * mins) }));
  const o: [number, number] = [m.origin.lon, m.origin.lat];
  const last = arcs.at(-1)?.coords ?? [];
  const tip = destination(m.origin, m.headingDeg, kmPerMin * (minutes.at(-1) ?? 60));
  return { ring: [o, ...last, o], arcs, axis: [o, [tip.lon, tip.lat]] };
}

export interface Arrival {
  name: string;
  point: LatLon;
  /** Minutes after the storm's origin time until closest approach; negative = already passed. */
  minutes: number;
  /** Epoch ms of closest approach. */
  at: number;
  /** Distance from the track at closest approach. */
  offTrackKm: number;
  /** Inside the ±spread fan (the storm's likely path). */
  inPath: boolean;
}

/** Closest approach of the projected track to each point, soonest first. */
export function arrivals(m: Motion, points: readonly (LatLon & { name: string })[], spreadDeg = 20, maxMinutes = 120): Arrival[] {
  const kmPerMin = (m.speedKt * KM_PER_NM) / 60;
  if (kmPerMin <= 0) return [];
  const out: Arrival[] = [];
  for (const pt of points) {
    const km = haversineKm(m.origin, pt);
    const off = toRad(bearingDeg(m.origin, pt) - m.headingDeg);
    const along = km * Math.cos(off);
    const cross = Math.abs(km * Math.sin(off));
    const minutes = along / kmPerMin;
    if (minutes > maxMinutes) continue;
    const angle = Math.abs(((toDeg(off) + 540) % 360) - 180);
    out.push({ name: pt.name, point: { lat: pt.lat, lon: pt.lon }, minutes, at: m.origin.t + minutes * 60_000, offTrackKm: cross, inPath: along > 0 && angle <= spreadDeg });
  }
  return out.sort((a, b) => Number(b.inPath) - Number(a.inPath) || a.minutes - b.minutes);
}
