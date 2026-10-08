import type { LineString, Polygon, MultiPolygon } from "geojson";
import { HttpError } from "../api/http";
import { cached } from "./cache";
import {
  lineThrough,
  mergeLines,
  mergePolygons,
  parseCurrentStorms,
  parseForecastPoints,
  parseLayerMap,
  stormFeatures,
  type TropicalLayerKind,
  type TropicalLayerMap,
} from "./tropical-parse";
import type { Feed } from "./types";
import { upstreamJson } from "./upstream";

/** A forecast position along an NHC track. */
export interface TropicalForecastPoint {
  lat: number;
  lon: number;
  /** ISO time (UTC), when known. */
  time: string | null;
  windKt: number | null;
  /** Short status label at that point, e.g. "H2", "TS", "TD". */
  label: string | null;
  /** Forecast hour (0 = advisory position), when the service sends it. */
  tau?: number | null;
  gustKt?: number | null;
  pressureMb?: number | null;
}

/** One active tropical cyclone (National Hurricane Center). */
export interface TropicalStorm {
  /** NHC id, e.g. "al052026". */
  id: string;
  name: string;
  /** NHC classification code: "HU", "TS", "TD", "STS", "PTC", "PC", "TY", … */
  classification: string;
  /** Human label, e.g. "Hurricane Milton", "Tropical Storm Nadine". */
  title: string;
  /** Saffir-Simpson category 1-5 for hurricanes, otherwise null. */
  category: number | null;
  windKt: number | null;
  pressureMb: number | null;
  lat: number;
  lon: number;
  /** Direction of motion (degrees, toward) and speed. */
  movement: { towardDeg: number | null; speedMph: number | null };
  advisoryUrl: string | null;
  /** ISO time of the latest advisory/status. */
  updated: string | null;
  cone: Polygon | MultiPolygon | null;
  track: LineString | null;
  forecast: TropicalForecastPoint[];
  pastTrack: LineString | null;
  /** Current intensity label ("H3", "TS", "TD", "PT", …), as on forecast points. */
  label?: string | null;
  /** NHC bin, e.g. "AT1", "EP2". */
  bin?: string | null;
  /** "Atlantic", "Eastern Pacific" or "Central Pacific". */
  basin?: string | null;
  /** Latest public advisory: number ("13", "13A") and issue time (ISO). */
  advisory?: { number: string | null; issued: string | null };
}

export interface TropicalResponse {
  storms: TropicalStorm[];
  updated: string;
}

const STORMS_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";
const MAPSERVER = "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer";

/** Layer ids per storm bin. The service's layer list changes rarely, so keep it for hours. */
function layerMap(): Promise<TropicalLayerMap> {
  return cached("tropical:layers", 6 * 3_600_000, async () => {
    const map = parseLayerMap(await upstreamJson(`${MAPSERVER}?f=json`, { timeoutMs: 10_000 }));
    if (!Object.keys(map).length) throw new Error("NHC MapServer lists no storm layers");
    return map;
  });
}

/** One MapServer layer as GeoJSON; `null` when it is missing or fails. */
async function queryLayer(id: number | undefined): Promise<unknown> {
  if (id == null) return null;
  const url = `${MAPSERVER}/${id}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
  // ArcGIS reports some errors as a 200 with `{ error }`; featuresOf() treats that as empty.
  return upstreamJson(url, { timeoutMs: 12_000 }).catch(() => null);
}

async function withGeometry(storm: TropicalStorm, ids: Partial<Record<TropicalLayerKind, number>> | undefined): Promise<TropicalStorm> {
  if (!ids) return storm;
  const [cone, track, points, past] = await Promise.all([
    queryLayer(ids.cone),
    queryLayer(ids.forecastTrack),
    queryLayer(ids.forecastPoints),
    queryLayer(ids.pastTrack ?? ids.pastPoints),
  ]);
  const forecast = parseForecastPoints(stormFeatures(points, storm), storm.advisory?.issued ?? storm.updated);
  return {
    ...storm,
    cone: mergePolygons(stormFeatures(cone, storm)),
    track: mergeLines(stormFeatures(track, storm)) ?? lineThrough(forecast),
    forecast,
    pastTrack: mergeLines(stormFeatures(past, storm)),
  };
}

async function loadTropical(): Promise<TropicalResponse> {
  // Layer discovery runs alongside the storm list; it is cached for hours, and
  // a failure only costs the geometry. Caught here so an unused rejection is handled.
  const layers = layerMap().catch(() => null);
  const raw = await upstreamJson(STORMS_URL, { timeoutMs: 12_000 });
  const storms = parseCurrentStorms(raw);
  if (!storms) throw new HttpError("Unrecognised NHC storm list", 502, STORMS_URL);
  const updated = new Date().toISOString();
  if (!storms.length) return { storms, updated };
  const map = await layers;
  return {
    storms: await Promise.all(storms.map((s) => withGeometry(s, s.bin ? map?.[s.bin] : undefined))),
    updated,
  };
}

/**
 * Active tropical cyclones (Atlantic, eastern and central Pacific) from the
 * National Hurricane Center, with cone, forecast track and points, and past
 * track from NOAA's ArcGIS service. If that service is down, storms still
 * come back, without geometry. The storm list itself failing is an error
 * (the cache serves the last good copy meanwhile), never "no storms".
 */
export const tropicalFeed: Feed<TropicalResponse> = {
  path: "/api/tropical",
  maxAge: 600,
  load: () => cached("tropical", 10 * 60_000, loadTropical),
};
