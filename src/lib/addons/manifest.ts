/**
 * Add-ons are plain JSON files (`stormcentral.json`) hosted on GitHub. They
 * are data, never code: a theme is a set of colours, a plugin is a list of map
 * layers (tile services or GeoJSON). Everything is validated here before it
 * reaches the store, the DOM or the map.
 */

import type { Theme } from "@/lib/theme";

/** Theme colour slots, each mapped to the `--color-<slot>` token. */
export const THEME_SLOTS = [
  "canvas",
  "surface-1",
  "surface-2",
  "surface-3",
  "line",
  "line-strong",
  "ink",
  "ink-2",
  "ink-3",
  "accent",
  "go",
  "caution",
  "nogo",
  "series-1",
  "series-2",
  "series-3",
  "grid",
] as const;
export type ThemeSlot = (typeof THEME_SLOTS)[number];

export interface AddonMeta {
  /** Stable key: the manifest URL it was installed from. */
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  /** Where it came from (the GitHub page to link to). */
  homepage: string | null;
  version: string | null;
}

export interface ThemeAddon extends AddonMeta {
  type: "theme";
  /** Light or dark base: picks the basemap and fills in any colour left out. */
  base: Theme;
  colors: Partial<Record<ThemeSlot, string>>;
  /** "vivid": full, bright animated skies that follow the weather and time of day (built-in effect, no code). */
  sky?: "vivid";
  /** Light by day, dark at night at the selected location ("base": "auto" in the manifest). */
  followSun?: boolean;
}

export interface RasterLayer {
  kind: "raster";
  id: string;
  name: string;
  /** `{z}/{x}/{y}`, `{quadkey}` or `{bbox-epsg-3857}` tile templates (https only). */
  tiles: string[];
  tileSize: 256 | 512;
  minzoom: number;
  maxzoom: number;
  opacity: number;
  attribution: string | null;
  /** Shown when the plugin is installed; people can turn each layer on or off. */
  visible: boolean;
}

export interface GeoJsonLayer {
  kind: "geojson";
  id: string;
  name: string;
  url: string;
  color: string;
  opacity: number;
  attribution: string | null;
  visible: boolean;
}

export type PluginLayer = RasterLayer | GeoJsonLayer;

export interface PluginAddon extends AddonMeta {
  type: "plugin";
  layers: PluginLayer[];
}

export type Addon = ThemeAddon | PluginAddon;

export class AddonError extends Error {}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

const MAX_LAYERS = 8;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Control characters out, whitespace collapsed. Rendered as React text, never HTML.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2048) return null;
  try {
    const u = new URL(v.replace(/\{/g, "%7B").replace(/\}/g, "%7D"));
    return u.protocol === "https:" && u.hostname.includes(".") ? v : null;
  } catch {
    return null;
  }
}

/** A tile template needs {z}, {x} and {y} (any order, for WMTS), {quadkey} or {bbox-epsg-3857}. */
const hasTileTokens = (t: string) => (t.includes("{z}") && t.includes("{x}") && t.includes("{y}")) || t.includes("{quadkey}") || t.includes("{bbox-epsg-3857}");
const DATE_TOKEN = /\{date(?:-([1-7]))?\}/g;

/**
 * Fills date tokens for daily imagery (NASA GIBS and similar): {date} is
 * yesterday in UTC, {date-2} two days ago, up to {date-7}.
 */
export function expandTileUrl(url: string, nowMs: number): string {
  return url.replace(DATE_TOKEN, (_, back: string | undefined) => new Date(nowMs - Number(back ?? 1) * 86_400_000).toISOString().slice(0, 10));
}
const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const slug = (v: unknown, i: number) => (typeof v === "string" && /^[a-z0-9-]{1,40}$/i.test(v) ? v : `layer-${i}`);

function parseLayer(raw: unknown, i: number): PluginLayer {
  if (!raw || typeof raw !== "object") throw new AddonError(`Layer ${i + 1} isn't an object.`);
  const l = raw as Record<string, unknown>;
  const name = text(l.name, 60) ?? `Layer ${i + 1}`;
  const attribution = text(l.attribution, 200);
  const opacity = num(l.opacity, 0.1, 1, 0.75);
  const visible = l.visible !== false;
  if (l.type === "raster") {
    const list = Array.isArray(l.tiles) ? l.tiles : [l.tiles];
    const tiles = list.map(httpsUrl).filter((t): t is string => !!t && hasTileTokens(t)).slice(0, 4);
    if (!tiles.length) throw new AddonError(`"${name}" needs an https tile URL with {z}/{x}/{y}, {quadkey} or {bbox-epsg-3857}.`);
    const minzoom = num(l.minzoom, 0, 22, 0);
    return {
      kind: "raster",
      id: slug(l.id, i),
      name,
      tiles,
      tileSize: l.tileSize === 512 ? 512 : 256,
      minzoom,
      maxzoom: num(l.maxzoom, minzoom, 22, 18),
      opacity,
      attribution,
      visible,
    };
  }
  if (l.type === "geojson") {
    const url = httpsUrl(l.url);
    if (!url) throw new AddonError(`"${name}" needs an https GeoJSON URL.`);
    return { kind: "geojson", id: slug(l.id, i), name, url, color: isHexColor(l.color) ? l.color : "#5b9cf6", opacity, attribution, visible };
  }
  throw new AddonError(`"${name}" has an unknown type; use "raster" or "geojson".`);
}

/** Validate a parsed `stormcentral.json`. Throws `AddonError` with a readable reason. */
export function parseAddon(raw: unknown, source: { id: string; homepage: string | null }): Addon {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AddonError("That file isn't a StormCentral add-on.");
  const m = raw as Record<string, unknown>;
  const name = text(m.name, 60);
  if (!name) throw new AddonError('The add-on needs a "name".');
  const meta: AddonMeta = {
    id: source.id,
    name,
    author: text(m.author, 60),
    description: text(m.description, 240),
    homepage: source.homepage,
    version: text(m.version, 20),
  };
  if (m.type === "theme") {
    const colors: Partial<Record<ThemeSlot, string>> = {};
    const given = m.colors && typeof m.colors === "object" ? (m.colors as Record<string, unknown>) : {};
    for (const slot of THEME_SLOTS) if (isHexColor(given[slot])) colors[slot] = given[slot] as string;
    const vivid = m.sky === "vivid";
    // A vivid-sky theme may use the built-in colours as they are.
    if (!Object.keys(colors).length && !vivid) throw new AddonError('The theme has no valid "colors" (hex values like "#2e3440").');
    const followSun = m.base === "auto" || m.followSun === true;
    return {
      ...meta,
      type: "theme",
      base: m.base === "light" ? "light" : "dark",
      colors,
      ...(vivid ? { sky: "vivid" as const } : {}),
      ...(followSun ? { followSun: true } : {}),
    };
  }
  if (m.type === "plugin") {
    const layers = (Array.isArray(m.layers) ? m.layers : []).slice(0, MAX_LAYERS).map(parseLayer);
    if (!layers.length) throw new AddonError('The plugin has no "layers".');
    const seen = new Set<string>();
    for (const l of layers) {
      while (seen.has(l.id)) l.id = `${l.id}-x`;
      seen.add(l.id);
    }
    return { ...meta, type: "plugin", layers };
  }
  throw new AddonError('Set "type" to "theme" or "plugin".');
}

/** CSS custom properties for a theme (only validated hex values ever get here). */
export function themeVars(t: Pick<ThemeAddon, "colors">): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const slot of THEME_SLOTS) {
    const c = t.colors[slot];
    if (c && isHexColor(c)) vars[`--color-${slot}`] = c;
  }
  const panel = t.colors["surface-1"];
  if (panel && isHexColor(panel)) vars["--overlay-bg"] = `color-mix(in srgb, ${panel} 93%, transparent)`;
  return vars;
}
