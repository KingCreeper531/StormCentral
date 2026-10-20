/**
 * The satellite map: cloud-free pictures of the ground in place of the plain
 * basemap, under the radar. (The GOES layer is the one with clouds; this is
 * the ground as it looks on a clear day.) While it's on, the basemap's area
 * fills (land, water, parks, buildings) are hidden; its lines (borders, roads,
 * rivers) and place names stay on top.
 *
 * The imagery is EOX's Sentinel-2 cloudless mosaic for 2016: the whole world
 * at 10 m a pixel, seamless, no key, and CC BY 4.0 (later years are
 * non-commercial only). The USGS National Map's imagery is sharper over the
 * US, but outside it, past zoom 8, it serves solid white or black tiles, which
 * would paint over Canada and Mexico along the border.
 */

export const SATELLITE_MAP_ID = "satmap";

export const SATELLITE_MAP_SOURCE = {
  tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
  tileSize: 256,
  minzoom: 0,
  // 10 m a pixel is zoom 14; past it MapLibre enlarges the zoom-14 tiles itself.
  maxzoom: 14,
  attribution: "Imagery: Sentinel-2 cloudless 2016 by EOX (contains modified Copernicus Sentinel data 2016), CC BY 4.0",
} as const;

/** Dimmed a little so the radar's light greens and blues and the place names stand out; more on the dark theme. */
export const SATELLITE_MAP_BRIGHTNESS = { dark: 0.72, light: 0.88 } as const;

interface StyleLayer {
  id: string;
  type: string;
}

/** Basemap layer types the imagery stands in for. */
const AREA_TYPES = new Set(["fill", "fill-extrusion", "hillshade", "color-relief", "raster"]);

/** Place names over imagery, as on a hybrid map: white with a dark halo (the light basemap's grey ones get lost). */
export const SATELLITE_MAP_LABELS = { "text-color": "#ffffff", "text-halo-color": "rgba(0, 0, 0, 0.75)", "text-halo-width": 1.2 } as const;

/**
 * Where the imagery goes in the style, which layers to hide and which labels
 * to restyle, given the basemap's own layer ids. The imagery sits just above
 * the basemap's background, under every basemap line (borders, roads,
 * rivers); the basemap's area fills, which would cover it, are hidden. Our
 * layers are never touched. `before` is undefined when the basemap is only a
 * background. (The hiding and restyling happen with the rest of the map
 * style, lib/map/style.ts.)
 */
export function satelliteMapPlan(
  layers: readonly StyleLayer[],
  basemap: ReadonlySet<string>,
): { before: string | undefined; hide: string[]; labels: string[] } {
  const base = layers.filter((l) => basemap.has(l.id));
  return {
    before: base.find((l) => l.type !== "background")?.id,
    hide: base.filter((l) => AREA_TYPES.has(l.type)).map((l) => l.id),
    labels: base.filter((l) => l.type === "symbol").map((l) => l.id),
  };
}
