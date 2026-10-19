/**
 * What a Professional-mode pane can show. Every product resolves to a list of
 * timed raster frames (the same RadarFrame the radar loop uses), so radar and
 * satellite panes share one frame engine and stay on the same loop clock.
 *
 * Sources (checked against each service's capabilities):
 *  - NEXRAD Level-III per site from IEM (all tilts IEM has; NOAA super-res
 *    tiles for the lowest reflectivity/velocity tilt), via the radar loop;
 *  - MRMS national products from NOAA's GeoServer: base and composite
 *    reflectivity, echo tops;
 *  - GOES-East/West ABI from NASA GIBS (visible, clean IR, Air Mass, GeoColor,
 *    Dust and Fire Temperature RGBs), 10-minute slots;
 *  - GOES water vapor from NOAA nowCOAST (latest image only: no time
 *    dimension).
 */
import { FAMILIES, type LegendStop, type ProductFamily } from "../radar/products";
import type { NoaaLayer } from "../radar/noaa";
import { DEFAULT_LATENCY_MIN, GIBS_WMS, gibsTime, SATELLITE_ATTRIBUTION, SLOT_MS, satelliteSlot, type GoesSat } from "../radar/satellite";
import type { RadarFrame } from "../radar/frames";

export const PRO_PRODUCT_IDS = [
  "ref",
  "vel",
  "srv",
  "cc",
  "zdr",
  "hc",
  "mosaic",
  "cref",
  "eet",
  "sat-vis",
  "sat-ir",
  "sat-wv",
  "sat-airmass",
  "sat-geocolor",
  "sat-dust",
  "sat-firetemp",
] as const;
export type ProProductId = (typeof PRO_PRODUCT_IDS)[number];

export const isProProductId = (v: unknown): v is ProProductId => typeof v === "string" && (PRO_PRODUCT_IDS as readonly string[]).includes(v);

export type ProProduct =
  | { id: ProProductId; kind: "site"; family: ProductFamily; label: string; short: string; group: "Radar (site)" }
  | { id: ProProductId; kind: "mosaic"; label: string; short: string; group: "Radar (national)" }
  | { id: ProProductId; kind: "mrms"; layer: string; label: string; short: string; group: "Radar (national)" }
  | { id: ProProductId; kind: "gibs"; layer: string; label: string; short: string; group: "Satellite"; maxzoom: number }
  | { id: ProProductId; kind: "nowcoast"; layer: string; label: string; short: string; group: "Satellite" };

const site = (id: ProProductId, family: ProductFamily): ProProduct => ({ id, kind: "site", family, label: FAMILIES[family].label, short: FAMILIES[family].short, group: "Radar (site)" });

export const PRO_PRODUCTS: Record<ProProductId, ProProduct> = {
  ref: site("ref", "reflectivity"),
  vel: site("vel", "velocity"),
  srv: site("srv", "srv"),
  cc: site("cc", "cc"),
  zdr: site("zdr", "zdr"),
  hc: site("hc", "hc"),
  mosaic: { id: "mosaic", kind: "mosaic", label: "Base Reflectivity (MRMS mosaic)", short: "MOSAIC", group: "Radar (national)" },
  cref: { id: "cref", kind: "mrms", layer: "conus_cref_qcd", label: "Composite Reflectivity (MRMS)", short: "CREF", group: "Radar (national)" },
  eet: { id: "eet", kind: "mrms", layer: "conus_neet_v18", label: "Echo Tops (MRMS)", short: "EET", group: "Radar (national)" },
  "sat-vis": { id: "sat-vis", kind: "gibs", layer: "ABI_Band2_Red_Visible_1km", label: "Visible (ABI band 2)", short: "VIS", group: "Satellite", maxzoom: 8 },
  "sat-ir": { id: "sat-ir", kind: "gibs", layer: "ABI_Band13_Clean_Infrared", label: "Clean IR (ABI band 13)", short: "IR", group: "Satellite", maxzoom: 7 },
  "sat-wv": { id: "sat-wv", kind: "nowcoast", layer: "goes_water_vapor_imagery", label: "Water Vapor (latest)", short: "WV", group: "Satellite" },
  "sat-airmass": { id: "sat-airmass", kind: "gibs", layer: "ABI_Air_Mass", label: "Air Mass RGB", short: "AIRMASS", group: "Satellite", maxzoom: 7 },
  "sat-geocolor": { id: "sat-geocolor", kind: "gibs", layer: "ABI_GeoColor", label: "GeoColor", short: "GEOCOLOR", group: "Satellite", maxzoom: 8 },
  "sat-dust": { id: "sat-dust", kind: "gibs", layer: "ABI_Dust", label: "Dust RGB", short: "DUST", group: "Satellite", maxzoom: 7 },
  "sat-firetemp": { id: "sat-firetemp", kind: "gibs", layer: "ABI_FireTemp", label: "Fire Temperature RGB", short: "FIRE", group: "Satellite", maxzoom: 7 },
};

/** GIBS only carries the RGB composites for GOES-East (which still covers the CONUS). */
const EAST_ONLY = new Set(["ABI_Air_Mass", "ABI_GeoColor", "ABI_Dust", "ABI_FireTemp"]);

/** The colour scale a product's tiles use, for the legend and for cursor sampling; null when it has none we know. */
export function productLegend(id: ProProductId): { stops: LegendStop[]; unit: string } | null {
  const p = PRO_PRODUCTS[id];
  if (p.kind === "site") return { stops: FAMILIES[p.family].legend, unit: FAMILIES[p.family].unit };
  if (p.kind === "mosaic" || id === "cref") return { stops: FAMILIES.reflectivity.legend, unit: "dBZ" };
  return null;
}

export const isSatellite = (id: ProProductId) => PRO_PRODUCTS[id].group === "Satellite";
export const needsSite = (id: ProProductId) => PRO_PRODUCTS[id].kind === "site";

/** The NOAA layer behind an MRMS product (frames via noaaFrames). */
export function mrmsLayer(id: ProProductId): NoaaLayer | null {
  const p = PRO_PRODUCTS[id];
  return p.kind === "mrms" ? { workspace: "conus", layer: p.layer, label: p.short, maxzoom: 7 } : null;
}

/**
 * Satellite frames are stamped with the loop time they pair with (scan time
 * plus GIBS's latency), so `frameAt` lines them up with radar frames; subtract
 * this to show the scan time.
 */
export const SAT_LATENCY_MS = DEFAULT_LATENCY_MIN * 60_000;

function gibsUrl(layer: string, sat: GoesSat, slotMs: number): string {
  const name = `GOES-${sat === "west" && !EAST_ONLY.has(layer) ? "West" : "East"}_${layer}`;
  return `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${name}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}&TIME=${gibsTime(slotMs)}`;
}

/**
 * Satellite frames for a loop: one GIBS image per 10-minute slot paired with
 * the loop's times (several radar frames share a slot), or the newest `count`
 * slots when there's no loop to follow yet.
 */
export function satelliteFrames(id: ProProductId, sat: GoesSat, loopTimes: readonly number[], count: number, now = Date.now()): RadarFrame[] {
  const p = PRO_PRODUCTS[id];
  if (p.kind === "nowcoast") {
    const t = Math.floor(now / SLOT_MS) * SLOT_MS + SAT_LATENCY_MS;
    const url = `https://nowcoast.noaa.gov/geoserver/satellite/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${p.layer}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=512&HEIGHT=512&BBOX={bbox-epsg-3857}`;
    return [{ id: `nowcoast-${p.layer}-${t}`, time: t, tileUrl: url, maxzoom: 8, tileSize: 512, attribution: "GOES imagery: NOAA nowCOAST" }];
  }
  if (p.kind !== "gibs") return [];
  const slots = new Set<number>();
  for (const t of loopTimes) slots.add(satelliteSlot(t));
  if (!slots.size) {
    const newest = satelliteSlot(now);
    for (let i = 0; i < count; i++) slots.add(newest - i * SLOT_MS);
  }
  return [...slots]
    .sort((a, b) => a - b)
    .slice(-Math.min(count, 10))
    .map((slot) => ({ id: `gibs-${p.layer}-${sat}-${slot}`, time: slot + SAT_LATENCY_MS, tileUrl: gibsUrl(p.layer, sat, slot), maxzoom: p.maxzoom, attribution: SATELLITE_ATTRIBUTION }));
}
