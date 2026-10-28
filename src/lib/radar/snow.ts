/**
 * Snow maps under the radar, both from NOAA's ArcGIS map services
 * (mapservices.weather.noaa.gov), drawn as `export` images per map tile:
 *
 * - Snowfall forecast: the Weather Prediction Center's probabilistic winter
 *   precipitation (precip/wpc_prob_winter_precip): the chance of at least
 *   4, 8 or 12 inches of snow in each of the next three 24-hour periods
 *   (Day 1, 2, 3). NWS snowfall *amounts* (NDFD SnowAmt) aren't published as
 *   a map service (its NDFD folder only has temperature), so the official
 *   snow product that is one stands in.
 * - Snow depth now: NOHRSC's national snow analysis (snow/NOHRSC_Snow_Analysis),
 *   the modelled depth on the ground across the lower 48, updated daily.
 *
 * Both are fixed-colour images, so the key is the service's own legend
 * (`/legend?f=json`), read at run time: it always matches what's drawn.
 */

const SERVICES = "https://mapservices.weather.noaa.gov";
export const WPC_WINTER = `${SERVICES}/vector/rest/services/precip/wpc_prob_winter_precip/MapServer`;
export const NOHRSC_SNOW = `${SERVICES}/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer`;

/**
 * What the snow overlay shows: off, the chance of snow in WPC's Day 1, 2 or 3
 * (the 24 hours from about now, the 24 after, the 24 after that), or the depth now.
 */
export type SnowMap = "off" | "day1" | "day2" | "day3" | "depth";
export type SnowDay = Exclude<SnowMap, "off" | "depth">;
export const SNOW_MAPS: readonly SnowMap[] = ["off", "day1", "day2", "day3", "depth"];
/** WPC's snowfall thresholds, inches. */
export type SnowThreshold = 4 | 8 | 12;
export const SNOW_THRESHOLDS: readonly SnowThreshold[] = [4, 8, 12];

export const isSnowMap = (v: unknown): v is SnowMap => (SNOW_MAPS as readonly unknown[]).includes(v);
export const isSnowThreshold = (v: unknown): v is SnowThreshold => (SNOW_THRESHOLDS as readonly unknown[]).includes(v);

/**
 * WPC's layers: a group per day (0, 5, 10), then within it ≥4", ≥8", ≥12"
 * of snow and ≥0.25" of ice. (Day 1 ≥4" = 1, Day 2 = 6, Day 3 = 11.)
 */
const WPC_DAY_GROUP: Record<SnowDay, number> = { day1: 0, day2: 5, day3: 10 };
const WPC_THRESHOLD_OFFSET: Record<SnowThreshold, number> = { 4: 1, 8: 2, 12: 3 };
/** NOHRSC's snow depth image (the Snow Depth group is 0; 1–2 are its boundary and footprint outlines). */
const NOHRSC_DEPTH_IMAGE = 3;

export const SNOW_ATTRIBUTION: Record<"forecast" | "depth", string> = {
  forecast: "Snowfall: NWS / WPC",
  depth: "Snow depth: NWS / NOHRSC",
};
/** WPC issues twice a day with updates between; NOHRSC once a day. Refresh well within either. */
export const SNOW_REFRESH_MS = 30 * 60_000;

export interface SnowSource {
  service: string;
  layer: number;
  attribution: string;
  /** Past this the service's own detail runs out; MapLibre stretches the last tiles. */
  maxzoom: number;
}

/** The service and layer for a snow map, or null when it's off. */
export function snowSource(map: SnowMap, threshold: SnowThreshold = 4): SnowSource | null {
  if (map === "off") return null;
  if (map === "depth") return { service: NOHRSC_SNOW, layer: NOHRSC_DEPTH_IMAGE, attribution: SNOW_ATTRIBUTION.depth, maxzoom: 10 };
  return { service: WPC_WINTER, layer: WPC_DAY_GROUP[map] + WPC_THRESHOLD_OFFSET[threshold], attribution: SNOW_ATTRIBUTION.forecast, maxzoom: 9 };
}

/** ArcGIS `export` template for MapLibre (`{bbox-epsg-3857}` is filled per tile). `slot` busts caches between updates. */
export function snowTileUrl(src: SnowSource, slot: number): string {
  const q = [
    "bbox={bbox-epsg-3857}",
    "bboxSR=3857",
    "imageSR=3857",
    "size=256,256",
    "dpi=96",
    "format=png32",
    "transparent=true",
    `layers=show:${src.layer}`,
    "f=image",
    `_=${slot}`,
  ].join("&");
  return `${src.service}/export?${q}`;
}

/** The service's legend, all layers (one request answers every threshold and day). */
export const snowLegendUrl = (src: SnowSource) => `${src.service}/legend?f=json`;

/** One key entry: the service's own swatch picture and label. */
export interface SnowLegendItem {
  label: string;
  /** A data: URL of the swatch. */
  image: string;
}

interface ArcLegend {
  layers?: { layerId?: number; legend?: { label?: string; imageData?: string; contentType?: string }[] }[];
}

/** The key for one layer out of an ArcGIS `/legend?f=json` answer. Entries without a picture are left out. */
export function parseSnowLegend(json: unknown, layer: number): SnowLegendItem[] {
  const layers = (json as ArcLegend | null)?.layers;
  if (!Array.isArray(layers)) return [];
  const entries = layers.find((l) => l?.layerId === layer)?.legend;
  if (!Array.isArray(entries)) return [];
  const out: SnowLegendItem[] = [];
  for (const e of entries) {
    if (typeof e?.imageData !== "string" || !/^[A-Za-z0-9+/=]+$/.test(e.imageData)) continue;
    const type = typeof e.contentType === "string" && /^image\/[a-z0-9.+-]+$/.test(e.contentType) ? e.contentType : "image/png";
    out.push({ label: typeof e.label === "string" ? e.label.trim() : "", image: `data:${type};base64,${e.imageData}` });
  }
  return out;
}

/** A WPC threshold in the person's units: "4 in", or "10 cm" (WPC's are whole inches, rounded). */
export function snowThresholdLabel(inches: SnowThreshold, metric: boolean): string {
  return metric ? `${Math.round(inches * 2.54)} cm` : `${inches} in`;
}
