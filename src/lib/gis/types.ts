import type { Feature, Geometry } from "geojson";

/**
 * What every custom layer (GRLevelX placefile, KML, GeoJSON) is turned into:
 * GeoJSON features with flat, map-ready style properties, so one set of map
 * layers draws them all.
 */
export type GisProps =
  | { kind: "fill"; color: string; opacity: number; hover?: string; minzoom: number }
  | { kind: "line"; color: string; opacity: number; width: number; hover?: string; minzoom: number }
  | { kind: "point"; color: string; hover?: string; minzoom: number }
  | { kind: "text"; text: string; color: string; size: number; dx: number; dy: number; hover?: string; minzoom: number }
  /** `icon` is `${file}-${number}` from the placefile's IconFile lines; `dx`/`dy` in pixels. */
  | { kind: "icon"; icon: string; rotate: number; dx: number; dy: number; hover?: string; minzoom: number };

export type GisFeature = Feature<Geometry, GisProps>;

/** A placefile's sprite sheet: icons are `w`×`h` cells, numbered from 1 left to right, then down. */
export interface IconFile {
  n: number;
  w: number;
  h: number;
  hotX: number;
  hotY: number;
  url: string;
}

export interface GisData {
  title: string | null;
  /** How often the source wants re-reading (placefiles' Refresh), seconds. */
  refreshSec: number | null;
  iconFiles: IconFile[];
  features: GisFeature[];
}

export type GisFormat = "placefile" | "kml" | "geojson";

/** Hex colour from 0–255 channels. */
export const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
