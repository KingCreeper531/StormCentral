/**
 * Custom map layers people bring themselves: GRLevelX placefiles, KML and
 * GeoJSON, by link or from a file. Everything becomes the same styled
 * features (./types), drawn by components/map/layers/gis-layers.tsx.
 */
import { parseGeoJson } from "./geojson";
import { parseKml } from "./kml";
import { looksLikePlacefile, parsePlacefile } from "./placefile";
import { restyleKnownFeeds, withoutContacts } from "./symbols";
import type { GisData, GisFormat } from "./types";

export type { GisData, GisFeature, GisFormat, GisProps, IconFile } from "./types";

/** Largest layer read (link or file). */
export const MAX_GIS_BYTES = 5 * 1024 * 1024;

/** Which format some text is, from its content (names and links can't be trusted). */
export function detectFormat(text: string, name = ""): GisFormat {
  const head = text.slice(0, 2000).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return "geojson";
  if (head.startsWith("<") && /<(\w+:)?kml\b/i.test(text.slice(0, 5000))) return "kml";
  if (/\.(geo)?json$/i.test(name)) return "geojson";
  if (/\.kml$/i.test(name)) return "kml";
  return "placefile";
}

/**
 * Parse a layer; `base` resolves a placefile's relative icon links. Phone
 * numbers and emails leave the hover text, and well-known feeds' icons
 * become symbols that say what they are (./symbols), aged against `now`.
 * Throws on unreadable GeoJSON.
 */
export function parseGis(text: string, format: GisFormat, base?: string, now = Date.now()): GisData {
  const data = format === "geojson" ? parseGeoJson(text) : format === "kml" ? parseKml(text) : parsePlacefile(text, base);
  for (const f of data.features) if (f.properties.hover) f.properties.hover = withoutContacts(f.properties.hover);
  return restyleKnownFeeds(data, now);
}

/**
 * Check a new layer before it's saved: its format and parsed data, or an
 * error ("not-a-layer", "unreadable") the layer list explains.
 */
export function readLayer(text: string, name = "", base?: string): { format: GisFormat; data: GisData } {
  const format = detectFormat(text, name);
  if (format === "placefile" && !looksLikePlacefile(text)) throw new Error("not-a-layer");
  let data: GisData;
  try {
    data = parseGis(text, format, base);
  } catch {
    throw new Error("unreadable");
  }
  if (format !== "placefile" && !data.features.length) throw new Error("not-a-layer");
  return { format, data };
}

/** A readable name for a layer: its own title, else the file or the link's last part. */
export function layerName(data: GisData | null, source: string): string {
  if (data?.title) return data.title.slice(0, 80);
  try {
    const u = new URL(source);
    return (decodeURIComponent(u.pathname.split("/").filter(Boolean).at(-1) ?? "") || u.hostname).slice(0, 80);
  } catch {
    return source.slice(0, 80);
  }
}
