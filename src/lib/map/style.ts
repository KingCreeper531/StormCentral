/**
 * The map's look, chosen by the person (components/map/map-style-controls):
 * which basemap, terrain shading and 3D terrain, and how the basemap's own
 * borders, roads, labels, water and land are drawn under the radar.
 *
 * The basemaps (CARTO, or MapTiler with a key) are vector styles on the
 * OpenMapTiles schema, so their layers can be sorted into groups by the data
 * they draw (`source-layer` and the classes in their filters) rather than by
 * id. `basemapOps` turns a style and the basemap's original layers into the
 * paint and layout values to set; every value is worked out from the
 * original, so switching something back restores the basemap as it was.
 * Pure; the map side is components/map/basemap-style.tsx.
 */
import type { Theme } from "../theme";
import { SATELLITE_MAP_LABELS, satelliteMapPlan } from "../radar/satellite-map";

export type BasemapId = "auto" | "dark" | "light" | "streets";
export const BASEMAPS: readonly BasemapId[] = ["auto", "dark", "light", "streets"];

export interface LineStyle {
  show: boolean;
  /** null: the basemap's own colour. */
  color: string | null;
  /** Times the basemap's own width. */
  width: number;
}

/** County lines: off, from zoom 9 as the basemap draws them, or at every zoom (our own lines below 9). */
export type CountyMode = "off" | "near" | "always";
export interface CountyStyle extends Omit<LineStyle, "show"> {
  show: CountyMode;
}

export type RoadMode = "off" | "major" | "all";

export interface MapStyle {
  basemap: BasemapId;
  /** Terrain shading strength, 0 (off) to 1. */
  hillshade: number;
  /** Mountains in 3D on the radar map (tilt with right-drag or two fingers). */
  terrain3d: boolean;
  /** How much taller than life the 3D terrain is drawn. */
  exaggeration: number;
  countries: LineStyle;
  states: LineStyle;
  counties: CountyStyle;
  /** Highways (motorways, trunk and primary roads) or every road. */
  roads: RoadMode;
  roadColor: string | null;
  water: string | null;
  land: string | null;
  /** Parks, woods and land use. */
  landcover: boolean;
  buildings: boolean;
  placeLabels: boolean;
  roadLabels: boolean;
  waterLabels: boolean;
  /** Points of interest, airports, peaks and house numbers. */
  poiLabels: boolean;
  /** Times the basemap's own label size. */
  labelSize: number;
}

const LINE: LineStyle = { show: true, color: null, width: 1 };

export const DEFAULT_MAP_STYLE: MapStyle = {
  basemap: "auto",
  hillshade: 0,
  terrain3d: false,
  exaggeration: 1.5,
  countries: { ...LINE },
  states: { ...LINE },
  counties: { show: "near", color: null, width: 1 },
  roads: "all",
  roadColor: null,
  water: null,
  land: null,
  landcover: true,
  buildings: true,
  placeLabels: true,
  roadLabels: true,
  waterLabels: true,
  poiLabels: true,
  labelSize: 1,
};

export const LIMITS = {
  width: [0.5, 3],
  labelSize: [0.8, 1.6],
  exaggeration: [1, 3],
} as const;

const clamp = (n: unknown, [lo, hi]: readonly [number, number], fallback: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);
const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const color = (c: unknown) => (isColor(c) ? c.toLowerCase() : null);
const bool = (b: unknown, fallback: boolean) => (typeof b === "boolean" ? b : fallback);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);

function line(raw: unknown, fallback: LineStyle): LineStyle {
  const l = (raw ?? {}) as Partial<LineStyle>;
  return { show: bool(l.show, fallback.show), color: color(l.color), width: clamp(l.width, LIMITS.width, fallback.width) };
}

/** A saved or shared style made whole and safe: known values only, defaults for the rest. */
export function normalizeMapStyle(raw: unknown): MapStyle {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof MapStyle, unknown>>;
  const d = DEFAULT_MAP_STYLE;
  const c = (s.counties ?? {}) as Partial<CountyStyle>;
  return {
    basemap: oneOf(s.basemap, BASEMAPS, d.basemap),
    hillshade: clamp(s.hillshade, [0, 1], d.hillshade),
    terrain3d: bool(s.terrain3d, d.terrain3d),
    exaggeration: clamp(s.exaggeration, LIMITS.exaggeration, d.exaggeration),
    countries: line(s.countries, d.countries),
    states: line(s.states, d.states),
    counties: { show: oneOf(c.show, ["off", "near", "always"] as const, d.counties.show), color: color(c.color), width: clamp(c.width, LIMITS.width, d.counties.width) },
    roads: oneOf(s.roads, ["off", "major", "all"] as const, d.roads),
    roadColor: color(s.roadColor),
    water: color(s.water),
    land: color(s.land),
    landcover: bool(s.landcover, d.landcover),
    buildings: bool(s.buildings, d.buildings),
    placeLabels: bool(s.placeLabels, d.placeLabels),
    roadLabels: bool(s.roadLabels, d.roadLabels),
    waterLabels: bool(s.waterLabels, d.waterLabels),
    poiLabels: bool(s.poiLabels, d.poiLabels),
    labelSize: clamp(s.labelSize, LIMITS.labelSize, d.labelSize),
  };
}

// ── Basemaps ────────────────────────────────────────────────────────────────

/** The basemap on screen: "auto" follows the app's theme. */
export function resolveBasemap(id: BasemapId, theme: Theme): Exclude<BasemapId, "auto"> {
  return id === "auto" ? theme : id;
}

export const isDarkBasemap = (id: Exclude<BasemapId, "auto">) => id === "dark";

/** Style URL: MapTiler's when a key is configured, otherwise CARTO's free basemaps. */
export function basemapUrl(id: Exclude<BasemapId, "auto">, maptilerKey?: string): string {
  if (maptilerKey) return `https://api.maptiler.com/maps/${id === "streets" ? "streets-v2" : `dataviz-${id}`}/style.json?key=${maptilerKey}`;
  const name = id === "dark" ? "dark-matter" : id === "light" ? "positron" : "voyager";
  return `https://basemaps.cartocdn.com/gl/${name}-gl-style/style.json`;
}

/** The OLED pass on the dark basemap: background and water pulled to near-black. */
export const DARK_LAND = "#030406";
export const DARK_WATER = "#070b12";

// ── Terrain ─────────────────────────────────────────────────────────────────

/**
 * Elevation tiles: the AWS Open Data terrain tiles (Mapzen's Terrarium
 * encoding; SRTM, USGS 3DEP, GMTED and others). Free, no key, CORS open.
 * They go to zoom 15; 12 is plenty for shading and 3D under weather and
 * keeps the tile count down.
 */
export const TERRAIN_SOURCE = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 12,
  attribution: "Terrain: Mapzen Terrain Tiles on AWS (SRTM, USGS 3DEP, GMTED, ETOPO1)",
} as const;

/** How far the map tilts in 3D. More shows the horizon and asks every feed for a far bigger area. */
export const MAX_PITCH = 60;
/** The tilt 3D terrain starts at, so turning it on shows something. */
export const START_PITCH = 50;

/** Hillshade paint for a strength and basemap. The "igor" method softens flat ground so radar colours stay true. */
export function hillshadePaint(strength: number, dark: boolean): Record<string, unknown> {
  return {
    "hillshade-method": "igor",
    "hillshade-exaggeration": Math.min(1, Math.max(0, strength)),
    "hillshade-shadow-color": dark ? "#000000" : "#3d4a5c",
    "hillshade-highlight-color": dark ? "#9aa4b5" : "#ffffff",
    "hillshade-accent-color": dark ? "#000000" : "#5c6b80",
  };
}

/** Sky and haze at the horizon when the map is tilted. */
export function skyFor(dark: boolean): Record<string, unknown> {
  return dark
    ? { "sky-color": "#05070c", "horizon-color": "#141b29", "fog-color": "#0b0f17", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.75, "atmosphere-blend": 0 }
    : { "sky-color": "#a9c8ec", "horizon-color": "#e4edf7", "fog-color": "#eef2f7", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.75, "atmosphere-blend": 0 };
}

// ── Sorting basemap layers into groups ──────────────────────────────────────

export type LayerGroup =
  | "land"
  | "water"
  | "waterways"
  | "landcover"
  | "buildings"
  | "countries"
  | "states"
  | "counties"
  | "roadsMajor"
  | "roadsMinor"
  | "placeLabels"
  | "roadLabels"
  | "waterLabels"
  | "poiLabels";

/** The parts of a style layer this module reads and writes. */
export interface BaseLayer {
  id: string;
  type: string;
  "source-layer"?: string;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

const MAJOR_ROADS = new Set(["motorway", "trunk", "primary"]);
/**
 * Protomaps' road layers (CARTO's styles since they moved to its tiles) say what they draw in their ids:
 * road_mot_…, tunnel_trunk_…, bridge_pri_… are major. Their filters, full of negations, don't say it plainly.
 */
const MAJOR_ROAD_ID = /(^|_)(mot|motorway|trunk|pri|primary|highway)(_|$)/;

/** Values a filter compares `key` with, in legacy (["==", "class", "x"]) or expression (["==", ["get", "class"], "x"]) syntax. */
export function filterValues(filter: unknown, key: string): (string | number)[] {
  const out: (string | number)[] = [];
  const isKey = (x: unknown) => x === key || (Array.isArray(x) && x[0] === "get" && x[1] === key);
  const lit = (x: unknown): unknown[] => (Array.isArray(x) ? (x[0] === "literal" && Array.isArray(x[1]) ? x[1] : x) : [x]);
  const take = (xs: unknown[]) => {
    for (const x of xs) if (typeof x === "string" || typeof x === "number") out.push(x);
  };
  const walk = (f: unknown) => {
    if (!Array.isArray(f)) return;
    const [op, a, ...rest] = f;
    if (typeof op !== "string") return;
    if (["==", "<=", "<", ">=", ">"].includes(op) && isKey(a)) take([rest[0]]);
    else if (op === "in" && isKey(a)) take(rest.length === 1 ? lit(rest[0]) : rest);
    else if (op === "match" && isKey(a)) {
      // ["match", input, labels, output, ..., fallback]: the labels whose output isn't false.
      for (let i = 0; i + 1 < rest.length; i += 2) if (rest[i + 1] !== false) take(lit(rest[i]));
    } else for (const x of f.slice(1)) walk(x);
  };
  walk(filter);
  return out;
}

const roleOf = (id: string) => (/case|casing|outline/i.test(id) ? "casing" : "fill");

/**
 * Which group a basemap layer belongs to, or null for layers this module leaves alone. Two tile schemas:
 * OpenMapTiles (MapTiler, CARTO's older tiles: place, transportation, boundary…) and Protomaps (CARTO's
 * tiles now: places, roads, boundaries, buildings, pois, landuse, water).
 */
export function layerGroup(layer: BaseLayer): LayerGroup | null {
  const sl = layer["source-layer"] ?? "";
  if (layer.type === "background") return "land";
  if (layer.type === "symbol") {
    if (sl === "place" || sl === "places") return "placeLabels";
    if (sl === "transportation_name" || sl === "roads") return "roadLabels";
    if (sl === "water_name" || sl === "waterway" || sl === "water") return "waterLabels";
    if (["poi", "pois", "aerodrome_label", "housenumber", "buildings", "mountain_peak"].includes(sl)) return "poiLabels";
    return null;
  }
  switch (sl) {
    case "boundaries": {
      if (layer.type !== "line") return null;
      const kinds = filterValues(layer.filter, "kind").map(String);
      if (kinds.includes("county") || /county/.test(layer.id)) return "counties";
      if (kinds.includes("region") || /state|region/.test(layer.id)) return "states";
      return "countries";
    }
    case "roads":
      return layer.type === "line" ? (MAJOR_ROAD_ID.test(layer.id) ? "roadsMajor" : "roadsMinor") : null;
    case "boundary": {
      if (layer.type !== "line") return null;
      const levels = filterValues(layer.filter, "admin_level").filter((v): v is number => typeof v === "number");
      const level = levels.length ? Math.min(...levels) : 2;
      return level <= 2 ? "countries" : level <= 4 ? "states" : "counties";
    }
    case "transportation": {
      if (layer.type !== "line") return null;
      const classes = filterValues(layer.filter, "class").map(String);
      return classes.some((c) => MAJOR_ROADS.has(c)) ? "roadsMajor" : "roadsMinor";
    }
    case "aeroway":
      return "roadsMinor";
    case "water":
      return layer.type === "fill" ? "water" : layer.type === "line" ? "waterways" : null;
    case "waterway":
      return layer.type === "line" ? "waterways" : null;
    case "landcover":
    case "landuse":
    case "park":
      return "landcover";
    case "building":
    case "buildings":
      return "buildings";
    default:
      return null;
  }
}

// ── Scaling zoom-dependent sizes ────────────────────────────────────────────

/**
 * A size property times `k`: plain numbers, legacy zoom functions ({stops})
 * and zoom curves (["interpolate"/"step", …, ["zoom"], …]) have their outputs
 * scaled; other expressions are wrapped in ["*", …] (allowed where no zoom
 * input is involved). Undefined (the property's default) becomes
 * `fallback × k`.
 */
export function scaleSize(value: unknown, k: number, fallback: number): unknown {
  if (k === 1) return value;
  const mul = (n: unknown) => (typeof n === "number" ? Math.round(n * k * 1000) / 1000 : n);
  if (value === undefined || value === null) return mul(fallback);
  if (typeof value === "number") return mul(value);
  if (Array.isArray(value)) {
    const [op] = value;
    if (op === "interpolate" || op === "interpolate-hcl" || op === "interpolate-lab") {
      // [op, interpolation, input, stop, output, stop, output, …]
      return value.map((x, i) => (i >= 3 && (i - 3) % 2 === 1 ? scaleSize(x, k, fallback) : x));
    }
    if (op === "step") {
      // ["step", input, output, stop, output, …]
      return value.map((x, i) => (i >= 2 && (i - 2) % 2 === 0 ? scaleSize(x, k, fallback) : x));
    }
    return JSON.stringify(value).includes('["zoom"]') ? value : ["*", value, k];
  }
  if (typeof value === "object" && Array.isArray((value as { stops?: unknown }).stops)) {
    const fn = value as { stops: [unknown, unknown][] };
    return { ...fn, stops: fn.stops.map(([z, v]) => [z, mul(v)]) };
  }
  return value;
}

// ── What to set on the basemap ──────────────────────────────────────────────

export interface StyleOp {
  id: string;
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
}

export interface OpsContext {
  /** The dark basemap (gets the OLED pass). */
  dark: boolean;
  /** The satellite map is under everything: area fills hidden, labels white with a dark halo. */
  satellite: boolean;
}

const LINE_DEFAULT_WIDTH = 1;
const TEXT_DEFAULT_SIZE = 16;

function shown(group: LayerGroup | null, s: MapStyle): boolean {
  switch (group) {
    case "countries":
    case "states":
      return s[group].show;
    case "counties":
      return s.counties.show !== "off";
    case "roadsMajor":
      return s.roads !== "off";
    case "roadsMinor":
      return s.roads === "all";
    case "landcover":
      return s.landcover;
    case "buildings":
      return s.buildings;
    case "placeLabels":
    case "roadLabels":
    case "waterLabels":
    case "poiLabels":
      return s[group];
    default:
      return true;
  }
}

/**
 * The layout and paint values for every basemap layer this module manages,
 * worked out from the basemap's original layers (as the style was loaded).
 * Values that match the original are still listed, so applying the ops
 * after any earlier ones always lands on the right state.
 */
export function basemapOps(layers: readonly BaseLayer[], s: MapStyle, ctx: OpsContext): StyleOp[] {
  const ops: StyleOp[] = [];
  // Under the satellite map: its plan says which area fills to hide (lib/radar/satellite-map).
  const satHide = new Set(ctx.satellite ? satelliteMapPlan(layers, new Set(layers.map((l) => l.id))).hide : []);
  for (const layer of layers) {
    const group = layerGroup(layer);
    const satHidden = satHide.has(layer.id);
    if (!group && !satHidden && layer.type !== "symbol") continue;
    const layout: Record<string, unknown> = {};
    const paint: Record<string, unknown> = {};
    const original = (layer.layout?.visibility as string | undefined) ?? "visible";
    layout.visibility = original === "none" || satHidden || !shown(group, s) ? "none" : "visible";

    const p = layer.paint ?? {};
    if (group === "land") paint["background-color"] = s.land ?? (ctx.dark ? DARK_LAND : p["background-color"]);
    if (group === "water") paint["fill-color"] = s.water ?? (ctx.dark ? DARK_WATER : p["fill-color"]);
    if (group === "waterways" && s.water) paint["line-color"] = s.water;
    else if (group === "waterways") paint["line-color"] = p["line-color"];
    if (group === "countries" || group === "states" || group === "counties") {
      const l = s[group];
      paint["line-color"] = l.color ?? p["line-color"];
      paint["line-width"] = scaleSize(p["line-width"], l.width, LINE_DEFAULT_WIDTH);
    }
    if ((group === "roadsMajor" || group === "roadsMinor") && layer.type === "line" && roleOf(layer.id) === "fill") {
      paint["line-color"] = s.roadColor ?? p["line-color"];
    }
    if (layer.type === "symbol") {
      layout["text-size"] = scaleSize(layer.layout?.["text-size"], s.labelSize, TEXT_DEFAULT_SIZE);
      for (const [prop, value] of Object.entries(SATELLITE_MAP_LABELS)) paint[prop] = ctx.satellite ? value : p[prop];
    }
    ops.push({ id: layer.id, layout, paint });
  }
  return ops;
}

/**
 * Where our own layers go relative to the basemap: terrain shading above the
 * land and parks but under water, borders and roads (the first basemap line
 * layer); our county lines with the basemap's borders (just under its first
 * state or country line).
 */
export function insertionPoints(layers: readonly BaseLayer[]): { hillshade: string | undefined; counties: string | undefined; countyMinzoom: number } {
  const groups = layers.map((l) => [l, layerGroup(l)] as const);
  const firstLine = groups.find(([l, g]) => l.type === "line" || g === "water")?.[0].id;
  const border = groups.find(([, g]) => g === "states" || g === "countries")?.[0].id;
  const county = groups.find(([, g]) => g === "counties")?.[0];
  return { hillshade: firstLine, counties: border, countyMinzoom: county?.minzoom ?? 9 };
}

/** The colour our zoomed-out county lines take: the person's, else the basemap's own county colour, else a neutral grey. */
export function countyLineColor(layers: readonly BaseLayer[], s: MapStyle, dark: boolean): string {
  if (s.counties.color) return s.counties.color;
  const own = layers.find((l) => layerGroup(l) === "counties")?.paint?.["line-color"];
  return typeof own === "string" ? own : dark ? "#3a4252" : "#a3acb9";
}

/** Our county lines' width: thin when zoomed out, as wide as the basemap's at the hand-off. */
export const countyLineWidth = (k: number) => ["interpolate", ["linear"], ["zoom"], 4, 0.3 * k, 9, 0.8 * k];

/** Nothing differs from the default (the controls hide their reset button). */
export function isDefaultStyle(s: MapStyle): boolean {
  return JSON.stringify(normalizeMapStyle(s)) === JSON.stringify(DEFAULT_MAP_STYLE);
}
