/**
 * Range rings and the measuring tool on the radar maps, the way RadarScope
 * and GRLevelX draw them: circles every 10, 25 or 50 miles (or km) around
 * the radar site or the location, bearing spokes every 30°, and the
 * great-circle distance and bearing between two points. Circles are
 * geodesic (every point the same distance from the centre), so they stay
 * right far north, where they look stretched on the Mercator map.
 * Pure; drawn by components/map/layers/range-rings-layer.tsx and
 * components/map/measure-tool.tsx.
 */
import type { Feature, FeatureCollection } from "geojson";
import { bearingDeg, compassPoint, destination, haversineKm, type LatLon } from "./geo";
import { MIN_PATH_KT } from "./storm-path";
import type { DistanceUnit } from "./weather/units";

type LonLat = [number, number];

/** Ring spacing choices, in the person's distance unit. */
export const RING_STEPS = [10, 25, 50] as const;
export type RingStep = (typeof RING_STEPS)[number];
export const DEFAULT_RING_STEP: RingStep = 25;
export const isRingStep = (v: unknown): v is RingStep => (RING_STEPS as readonly unknown[]).includes(v);

export const KM_PER_UNIT: Record<DistanceUnit, number> = { mi: 1.609344, km: 1 };
/** Rings reach about as far as a WSR-88D sees storms (250 mi or km), at most this many. */
const REACH = 250;
const MAX_RINGS = 10;
export const SPOKE_STEP_DEG = 30;

export const ringCount = (step: number) => Math.max(1, Math.min(MAX_RINGS, Math.floor(REACH / step)));

/** Longitudes made continuous (no 360° jump where a line crosses the antimeridian), so the map draws it in one piece. */
function unwrap(coords: LonLat[]): LonLat[] {
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]![0];
    let lon = coords[i]![0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    coords[i]![0] = lon;
  }
  return coords;
}

/** A circle of points `km` from `center` (great-circle distance), closed, as [lon, lat]. */
export function geodesicCircle(center: LatLon, km: number, segments = 120): LonLat[] {
  const ring: LonLat[] = [];
  for (let i = 0; i <= segments; i++) {
    const p = destination(center, (i / segments) * 360, km);
    ring.push([p.lon, p.lat]);
  }
  return unwrap(ring);
}

/** The great-circle path from `a` to `b`, a point every `stepKm` or so (a straight line on the map is not the shortest way). */
export function greatCircleLine(a: LatLon, b: LatLon, stepKm = 20): LonLat[] {
  const km = haversineKm(a, b);
  const deg = bearingDeg(a, b);
  const n = Math.max(1, Math.min(200, Math.ceil(km / stepKm)));
  const line: LonLat[] = [[a.lon, a.lat]];
  for (let i = 1; i < n; i++) {
    const p = destination(a, deg, (km * i) / n);
    line.push([p.lon, p.lat]);
  }
  line.push([b.lon, b.lat]);
  return unwrap(line);
}

/**
 * The rings around `center`, every `step` of `unit`, with a label on each
 * (on the north side) and, with `spokes`, a line every 30° out to the last
 * ring with its bearing at the end. Features carry `kind`: ring, spoke,
 * label (`label`: "25 mi") or spoke-label (`label`: "120°").
 */
export function rangeRings(center: LatLon, step: number, unit: DistanceUnit, spokes = false): FeatureCollection {
  const features: Feature[] = [];
  const n = ringCount(step);
  const stepKm = step * KM_PER_UNIT[unit];
  for (let i = 1; i <= n; i++) {
    const km = i * stepKm;
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: geodesicCircle(center, km) }, properties: { kind: "ring" } });
    const at = destination(center, 0, km);
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [at.lon, at.lat] }, properties: { kind: "label", label: `${i * step} ${unit}` } });
  }
  if (spokes) {
    const outer = n * stepKm;
    for (let deg = 0; deg < 360; deg += SPOKE_STEP_DEG) {
      const end = destination(center, deg, outer);
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: greatCircleLine(center, end) }, properties: { kind: "spoke" } });
      const tip = destination(center, deg, outer + stepKm * 0.3);
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [tip.lon, tip.lat] }, properties: { kind: "spoke-label", label: `${deg}°` } });
    }
  }
  return { type: "FeatureCollection", features };
}

export interface Measurement {
  km: number;
  /** Initial great-circle bearing from the first point, degrees clockwise from north. */
  bearing: number;
  compass: ReturnType<typeof compassPoint>;
}

export function measure(a: LatLon, b: LatLon): Measurement {
  const bearing = bearingDeg(a, b);
  return { km: haversineKm(a, b), bearing, compass: compassPoint(bearing) };
}

/** A bearing as the map tools write it: whole degrees, 0–359. */
export const bearingLabel = (deg: number) => `${Math.round(((deg % 360) + 360) % 360) % 360}°`;

/** Minutes for a storm moving at `speedKt` to cover `km`; null when it's barely moving. */
export function minutesToCover(km: number, speedKt: number | null | undefined): number | null {
  if (speedKt == null || !(speedKt >= MIN_PATH_KT) || !Number.isFinite(km)) return null;
  return (km / (speedKt * 1.852)) * 60;
}
