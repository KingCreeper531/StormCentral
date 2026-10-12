import { HttpError } from "../api/http";
import { bearingDeg, haversineKm, type LatLon } from "../geo";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

/** NIFC Wildland Fire Interagency Geospatial Services: current incident locations (US). */
const WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";

export interface Wildfire {
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  /** Direction from the location to the fire, degrees. */
  bearingDeg: number;
  acres: number | null;
  /** 0–100, null when not reported. */
  contained: number | null;
  discovered: string | null;
  /** "Wildfire" or "Complex" (several fires managed together). */
  kind: "Wildfire" | "Complex";
  cause: string | null;
}

export interface WildfiresResponse {
  fires: Wildfire[];
  radiusKm: number;
}

interface RawFeature {
  attributes?: {
    IncidentName?: string;
    IncidentSize?: number | null;
    PercentContained?: number | null;
    FireDiscoveryDateTime?: number | null;
    IncidentTypeCategory?: string;
    FireCause?: string | null;
  };
  geometry?: { x?: number; y?: number };
}

/**
 * Uncontained wildfires within `radiusKm`, nearest first.
 */
export function parseWildfires(raw: unknown, p: LatLon, radiusKm: number, nowMs = Date.now()): Wildfire[] {
  const features = (raw as { features?: RawFeature[] })?.features;
  if (!Array.isArray(features)) return [];
  const out: Wildfire[] = [];
  for (const f of features) {
    const a = f.attributes ?? {};
    const x = f.geometry?.x;
    const y = f.geometry?.y;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (a.IncidentTypeCategory !== "WF" && a.IncidentTypeCategory !== "CX") continue; // not prescribed burns
    const contained = typeof a.PercentContained === "number" ? Math.max(0, Math.min(100, a.PercentContained)) : null;
    if (contained === 100) continue;
    const at = { lat: y, lon: x };
    const distanceKm = haversineKm(p, at);
    if (distanceKm > radiusKm) continue;
    const acres = typeof a.IncidentSize === "number" && a.IncidentSize >= 0 ? a.IncidentSize : null;
    const found = typeof a.FireDiscoveryDateTime === "number" ? a.FireDiscoveryDateTime : null;
    const name = (a.IncidentName ?? "").trim();
    // Unsized reports are mostly quick initial-attack calls; keep them only for a day, and never
    // the dispatch-numbered ones ("LAC-368088") that some agencies file for every small start.
    if ((acres ?? 0) < 1 && (found == null || nowMs - found > 86_400_000 || /^[a-z]{2,4}-?\d{4,}$/i.test(name))) continue;
    out.push({
      // NIFC names are often all caps ("ROWE CREEK COMPLEX").
      name: name ? (name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : name) : "Unnamed fire",
      lat: y,
      lon: x,
      distanceKm,
      bearingDeg: bearingDeg(p, at),
      acres,
      contained,
      discovered: found != null ? new Date(found).toISOString() : null,
      kind: a.IncidentTypeCategory === "CX" ? "Complex" : "Wildfire",
      cause: a.FireCause?.trim() || null,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** `lat` & `lon` (optional `radiusKm`, 25–500, default 250): active wildfires nearby. */
export const wildfiresFeed: Feed<WildfiresResponse> = {
  path: "/api/wildfires",
  maxAge: 900,
  async load(sp) {
    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    const lat = Math.round(p.lat * 4) / 4;
    const lon = Math.round(p.lon * 4) / 4;
    const radiusKm = Math.round(Math.min(500, Math.max(25, Number(sp.get("radiusKm")) || 250)));
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    return cached(`wildfires:${lat}:${lon}:${radiusKm}`, 15 * 60_000, async () => {
      const params = new URLSearchParams({
        where: "IncidentTypeCategory IN ('WF','CX') AND (PercentContained IS NULL OR PercentContained < 100)",
        geometry: [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(3)).join(","),
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,IncidentTypeCategory,FireCause",
        returnGeometry: "true",
        outSR: "4326",
        resultRecordCount: "500",
        f: "json",
      });
      const raw = await upstreamJson<{ error?: { message?: string } }>(`${WFIGS}?${params}`, { timeoutMs: 20_000 });
      // ArcGIS reports query errors in a 200 response.
      if (raw?.error) throw new HttpError(`NIFC: ${raw.error.message ?? "query failed"}`, 502);
      // Distances from the cache cell's centre, so every user sharing the entry sees the same list.
      return { fires: parseWildfires(raw, { lat, lon }, radiusKm).slice(0, 12), radiusKm };
    });
  },
};
