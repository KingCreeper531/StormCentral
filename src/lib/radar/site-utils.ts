import type { FeatureCollection, Point } from "geojson";
import { haversineKm, type LatLon } from "../geo";
import { NEXRAD_SITES } from "./sites";

export interface RadarSite {
  icao: string;
  place: string;
  state: string;
  lat: number;
  lon: number;
}

export const RADAR_SITES: readonly RadarSite[] = NEXRAD_SITES.map(([icao, place, state, lat, lon]) => ({
  icao,
  place,
  state,
  lat,
  lon,
}));

const BY_ID = new Map(RADAR_SITES.map((s) => [s.icao, s]));

export const getSite = (icao: string | null | undefined) => (icao ? BY_ID.get(icao.toUpperCase()) : undefined);

export function nearestSites(p: LatLon, n = 1): (RadarSite & { distanceKm: number })[] {
  return RADAR_SITES.map((s) => ({ ...s, distanceKm: haversineKm(p, s) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}

/** WSR-88D effective range for Level-III products (~230 km reflectivity). */
export const RADAR_RANGE_KM = 230;

export function sitesGeoJson(): FeatureCollection<Point, { icao: string; label: string }> {
  return {
    type: "FeatureCollection",
    features: RADAR_SITES.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { icao: s.icao, label: `${s.icao}` },
    })),
  };
}
