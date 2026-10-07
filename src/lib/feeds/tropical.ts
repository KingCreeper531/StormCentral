import type { LineString, Polygon, MultiPolygon } from "geojson";
import { HttpError } from "../api/http";
import type { Feed } from "./types";

/** A forecast position along an NHC track. */
export interface TropicalForecastPoint {
  lat: number;
  lon: number;
  /** ISO time (UTC), when known. */
  time: string | null;
  windKt: number | null;
  /** Short status label at that point, e.g. "H2", "TS", "TD". */
  label: string | null;
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
}

export interface TropicalResponse {
  storms: TropicalStorm[];
  updated: string;
}

/** Active tropical cyclones with cone, forecast track and points. */
export const tropicalFeed: Feed<TropicalResponse> = {
  path: "/api/tropical",
  maxAge: 900,
  async load() {
    throw new HttpError("Tropical cyclones aren't implemented yet", 501);
  },
};
