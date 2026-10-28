import type { BBox } from "../geo";
import type { FlightCategory } from "./decode";

/**
 * Aviation weather on the radar map, from aviationweather.gov's Data API
 * (NOAA's Aviation Weather Center, public domain): airports coloured by
 * flight category, their METAR and TAF, and SIGMETs, convective SIGMETs and
 * (G-)AIRMETs. Shared by the feed (lib/feeds/aviation), the map layer and
 * the cards. For situational awareness, not a weather briefing.
 */

export type { FlightCategory } from "./decode";

/** Flight-category colours, as on aviationweather.gov and ForeFlight. */
export const CATEGORY_COLORS: Record<FlightCategory, string> = {
  VFR: "#22c55e",
  MVFR: "#3b82f6",
  IFR: "#ef4444",
  LIFR: "#d946ef",
};
/** An airport whose latest report doesn't give a category (sensor out). */
export const UNKNOWN_CATEGORY_COLOR = "#9aa0a6";

/**
 * One airport on the wire: [ICAO id, lat, lon, flight category]. Only what the
 * dots need; the card loads the airport's full METAR and TAF when it opens.
 */
export type AirportRow = [id: string, lat: number, lon: number, category: FlightCategory | null];

export interface AviationMetarsResponse {
  airports: AirportRow[];
  updated: string;
}

/** An airport's latest reports, as sent, for the card to decode. */
export interface AirportResponse {
  id: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  /** Field elevation, metres. */
  elevM: number | null;
  metar: { raw: string; time: string | null } | null;
  taf: { raw: string; issued: string | null } | null;
  updated: string;
}

/**
 * SIGMET: severe turbulence, icing or volcanic ash for every aircraft.
 * Convective SIGMET: thunderstorms (lines, areas, embedded), with tops.
 * AIRMET: moderate hazards (IFR, mountain obscuration, turbulence, icing, strong surface wind),
 * as text AIRMETs or as G-AIRMET snapshots.
 */
export type AdvisoryKind = "sigmet" | "convective" | "airmet" | "gairmet";

/** What the advisory warns of, for its colour and title. */
export type AdvisoryHazard = "convective" | "turbulence" | "icing" | "ifr" | "mountain" | "ash" | "wind" | "llws" | "other";

export interface AviationAdvisory {
  /** Unique within one response. */
  id: string;
  kind: AdvisoryKind;
  hazard: AdvisoryHazard;
  /** ISO times. A G-AIRMET is a snapshot: `from` is its valid time and `to` the next snapshot's. */
  from: string;
  to: string;
  /** Altitudes in feet (MSL), when given. */
  baseFt: number | null;
  topFt: number | null;
  /** The advisory as issued, or for G-AIRMETs its hazard and cause ("CIG BLW 010/VIS BLW 3SM BR"). */
  text: string;
  /** Outline, [lon, lat] pairs, closed. */
  ring: [number, number][];
}

export interface AviationAdvisoriesResponse {
  advisories: AviationAdvisory[];
  /** Products that couldn't be loaded this time. */
  unavailable: ("sigmets" | "gairmets")[];
  updated: string;
}

/**
 * Advisory colours, close to aviationweather.gov's: convective red, turbulence
 * orange, icing blue, IFR purple, mountain obscuration pink, ash grey, wind brown.
 * SIGMETs draw solid, AIRMETs dashed.
 */
export const HAZARD_COLORS: Record<AdvisoryHazard, string> = {
  convective: "#ff453a",
  turbulence: "#f59e0b",
  icing: "#38bdf8",
  ifr: "#a78bfa",
  mountain: "#f472b6",
  ash: "#d1d5db",
  wind: "#c08a4a",
  llws: "#fb923c",
  other: "#e5e7eb",
};

export const HAZARD_LABELS: Record<AdvisoryHazard, string> = {
  convective: "Thunderstorms",
  turbulence: "Turbulence",
  icing: "Icing",
  ifr: "IFR conditions",
  mountain: "Mountain obscuration",
  ash: "Volcanic ash",
  wind: "Strong surface wind",
  llws: "Low-level wind shear",
  other: "Hazard",
};

export const KIND_LABELS: Record<AdvisoryKind, string> = {
  sigmet: "SIGMET",
  convective: "Convective SIGMET",
  airmet: "AIRMET",
  gairmet: "G-AIRMET",
};

// ── Airport tiles ────────────────────────────────────────────────────────────
/**
 * Airports load by 10° tiles of the visible map, so everyone looking at the
 * same area shares one cached upstream request per tile, and a request never
 * grows past what the Data API returns at once.
 */
export const AVIATION_TILE_DEG = 10;
/** About the contiguous US on a desktop screen; wider views show no airports. */
export const MAX_AVIATION_TILES = 24;

/** The view grown out to whole tiles, as [west, south, east, north]; null when it covers too many. */
export function snapToTiles(b: BBox): [number, number, number, number] | null {
  const s = AVIATION_TILE_DEG;
  const clampLon = (v: number) => Math.min(180, Math.max(-180, v));
  const clampLat = (v: number) => Math.min(90, Math.max(-90, v));
  const box: [number, number, number, number] = [
    Math.floor(clampLon(b.west) / s) * s,
    Math.floor(clampLat(b.south) / s) * s,
    Math.ceil(clampLon(b.east) / s) * s,
    Math.ceil(clampLat(b.north) / s) * s,
  ];
  // A view that is a line (or wrapped oddly) still gets one tile.
  if (box[2] <= box[0]) box[2] = Math.min(180, box[0] + s);
  if (box[3] <= box[1]) box[3] = Math.min(90, box[1] + s);
  return tilesIn(box).length > MAX_AVIATION_TILES ? null : box;
}

/** South-west corners ([lat, lon]) of the tiles in a tile-aligned box. */
export function tilesIn([w, s, e, n]: readonly [number, number, number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let lat = s; lat < n; lat += AVIATION_TILE_DEG) for (let lon = w; lon < e; lon += AVIATION_TILE_DEG) out.push([lat, lon]);
  return out;
}

/** Parses and checks a `bbox=w,s,e,n` that is aligned to the tile grid; null when it isn't. */
export function parseTileBox(raw: string | null): [number, number, number, number] | null {
  const parts = raw?.split(",").map((v) => (v.trim() === "" ? Number.NaN : Number(v)));
  if (!parts || parts.length !== 4 || !parts.every((v) => Number.isInteger(v) && v % AVIATION_TILE_DEG === 0)) return null;
  const [w, s, e, n] = parts as [number, number, number, number];
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  return tilesIn([w, s, e, n]).length > MAX_AVIATION_TILES ? null : [w, s, e, n];
}

/** ICAO (or FAA) airport id: KOKC, PANC, 2R4… */
export const AIRPORT_ID = /^[A-Z0-9]{3,4}$/;
