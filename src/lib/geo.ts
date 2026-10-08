/** Geodesy helpers. Coordinates follow GeoJSON order ([lon, lat]) unless named. */

export interface LatLon {
  lat: number;
  lon: number;
}

const R_EARTH_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

export function compassPoint(deg: number): (typeof COMPASS)[number] {
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[i] as (typeof COMPASS)[number];
}

type Ring = ReadonlyArray<readonly [number, number] | readonly number[]>;

/** Ray-casting point-in-ring (ring may be open or closed). */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly number[] as [number, number];
    const [xj, yj] = ring[j] as readonly number[] as [number, number];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Polygon with holes: inside outer ring and outside every hole. */
export function pointInPolygon(lon: number, lat: number, rings: ReadonlyArray<Ring>): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(lon, lat, outer)) return false;
  return !holes.some((h) => pointInRing(lon, lat, h));
}

export type PolygonalGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export function geometryContains(geometry: PolygonalGeometry | null | undefined, p: LatLon): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(p.lon, p.lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((poly) => pointInPolygon(p.lon, p.lat, poly));
  return false;
}

/** Distance (km) from p to the nearest vertex of a polygonal geometry — cheap proximity proxy. */
export function distanceToGeometryKm(geometry: PolygonalGeometry, p: LatLon): number {
  if (geometryContains(geometry, p)) return 0;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = Number.POSITIVE_INFINITY;
  for (const poly of polys)
    for (const ring of poly)
      for (const [lon, lat] of ring as [number, number][]) best = Math.min(best, haversineKm(p, { lat, lon }));
  return best;
}

export function geometryCentroid(geometry: PolygonalGeometry): LatLon {
  const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!ring?.length) return { lat: 0, lon: 0 };
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring as [number, number][]) {
    lon += x;
    lat += y;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

/** Web-Mercator Y (unitless, radians) for a latitude, and its inverse. */
export const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2));
export const latFromMercatorY = (y: number) => toDeg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function bboxAround(p: LatLon, dLat: number, dLon: number): BBox {
  return { west: p.lon - dLon, south: p.lat - dLat, east: p.lon + dLon, north: p.lat + dLat };
}
