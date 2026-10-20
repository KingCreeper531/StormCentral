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
 *    dimension);
 *  - other countries' national radar composites (Canada, Germany, Finland,
 *    the Netherlands, Japan) from their weather services (lib/radar/intl).
 */
import { FAMILIES, type ProductFamily } from "../radar/products";
import type { NoaaLayer } from "../radar/noaa";
import { INTL_RADARS, type IntlRadarId } from "../radar/intl";
import { DEFAULT_LATENCY_MIN, GIBS_WMS, gibsTime, SATELLITE_ATTRIBUTION, SLOT_MS, satelliteSlot, type GoesSat } from "../radar/satellite";
import type { RadarFrame } from "../radar/frames";
import { PRO_SERVER } from "./server";
import type { DecodedScaleId } from "./scales";
import type { Moment } from "./nexrad/level2";

export const PRO_PRODUCT_IDS = [
  "ref",
  "vel",
  "srv",
  "cc",
  "zdr",
  "hc",
  "kdp",
  "vil",
  "eet-site",
  "vol-ref",
  "vol-vel",
  "vol-zdr",
  "vol-cc",
  "mosaic",
  "cref",
  "eet",
  "mrms-mesh",
  "mrms-mesh60",
  "mrms-rotation",
  "mrms-vil",
  "intl-eccc",
  "intl-dwd",
  "intl-fmi",
  "intl-knmi",
  "intl-jma",
  "sat-vis",
  "sat-ir",
  "sat-wv",
  "sat-airmass",
  "sat-geocolor",
  "sat-dust",
  "sat-firetemp",
  "goes-dcp",
  "goes-nightmicro",
  "goes-sandwich",
] as const;
export type ProProductId = (typeof PRO_PRODUCT_IDS)[number];

export const isProProductId = (v: unknown): v is ProProductId => typeof v === "string" && (PRO_PRODUCT_IDS as readonly string[]).includes(v);

export type ProGroup = "Radar (site)" | "Radar (volume)" | "Radar (national)" | "Radar (other countries)" | "Satellite";

interface Base {
  id: ProProductId;
  label: string;
  short: string;
  group: ProGroup;
}

export type ProProduct =
  /** Site tiles (NOAA super-res / IEM) at the lowest tilt; decoded Level III (`l3Letter`) above it. */
  | (Base & { kind: "site"; family: ProductFamily; l3Letter?: string; scale?: DecodedScaleId })
  /** Decoded Level III from AWS: a tilt-based product (`letter`) or a single one (`code`). */
  | (Base & { kind: "l3"; letter?: string; code?: string; scale: DecodedScaleId })
  /** Decoded Level II volume (desktop): any cut of a moment. */
  | (Base & { kind: "l2"; moment: Moment; scale: DecodedScaleId })
  | (Base & { kind: "mosaic" })
  | (Base & { kind: "mrms"; layer: string })
  /** Rendered by the Pro data server (pro-server/), once one is set in Settings. */
  | (Base & { kind: "server"; serverId: string })
  /** Another country's national radar composite (lib/radar/intl). */
  | (Base & { kind: "intl"; source: IntlRadarId })
  | (Base & { kind: "gibs"; layer: string; maxzoom: number })
  | (Base & { kind: "nowcoast"; layer: string });

const site = (id: ProProductId, family: ProductFamily, l3Letter?: string, scale?: DecodedScaleId): ProProduct => ({
  id,
  kind: "site",
  family,
  l3Letter,
  scale,
  label: FAMILIES[family].label,
  short: FAMILIES[family].short,
  group: "Radar (site)",
});
const l3 = (id: ProProductId, label: string, short: string, scale: DecodedScaleId, at: { letter: string } | { code: string }): ProProduct => ({ id, kind: "l3", label, short, scale, group: "Radar (site)", ...at });
const vol = (id: ProProductId, label: string, short: string, moment: Moment, scale: DecodedScaleId): ProProduct => ({ id, kind: "l2", moment, scale, label, short, group: "Radar (volume)" });

const intl = (id: ProProductId, source: IntlRadarId, short: string): ProProduct => ({
  id,
  kind: "intl",
  source,
  short,
  label: `${INTL_RADARS[source].country} (${INTL_RADARS[source].short}, ${INTL_RADARS[source].measures})`,
  group: "Radar (other countries)",
});

export const PRO_PRODUCTS: Record<ProProductId, ProProduct> = {
  ref: site("ref", "reflectivity", "B", "ref"),
  vel: site("vel", "velocity", "G", "vel"),
  srv: site("srv", "srv"),
  cc: l3("cc", FAMILIES.cc.label, "CC", "cc", { letter: "C" }),
  zdr: l3("zdr", FAMILIES.zdr.label, "ZDR", "zdr", { letter: "X" }),
  hc: l3("hc", FAMILIES.hc.label, "HC", "hc", { letter: "H" }),
  kdp: l3("kdp", "Specific Differential Phase", "KDP", "kdp", { letter: "K" }),
  vil: l3("vil", "Digital VIL", "VIL", "vil", { code: "DVL" }),
  "eet-site": l3("eet-site", "Enhanced Echo Tops (site)", "EET", "eet", { code: "EET" }),
  "vol-ref": vol("vol-ref", "Reflectivity, any tilt (Level II)", "Z", "REF", "ref"),
  "vol-vel": vol("vol-vel", "Velocity, any tilt (Level II)", "V", "VEL", "vel"),
  "vol-zdr": vol("vol-zdr", "ZDR, any tilt (Level II)", "ZDR", "ZDR", "zdr"),
  "vol-cc": vol("vol-cc", "CC (ρHV), any tilt (Level II)", "ρHV", "RHO", "cc"),
  mosaic: { id: "mosaic", kind: "mosaic", label: "Base Reflectivity (MRMS mosaic)", short: "MOSAIC", group: "Radar (national)" },
  cref: { id: "cref", kind: "mrms", layer: "conus_cref_qcd", label: "Composite Reflectivity (MRMS)", short: "CREF", group: "Radar (national)" },
  eet: { id: "eet", kind: "mrms", layer: "conus_neet_v18", label: "Echo Tops (MRMS)", short: "EET", group: "Radar (national)" },
  "mrms-mesh": { id: "mrms-mesh", kind: "server", serverId: "mrms-mesh", label: "Hail size, MESH (MRMS)", short: "MESH", group: "Radar (national)" },
  "mrms-mesh60": { id: "mrms-mesh60", kind: "server", serverId: "mrms-mesh60", label: "Hail size, 60-min max (MRMS)", short: "MESH60", group: "Radar (national)" },
  "mrms-rotation": { id: "mrms-rotation", kind: "server", serverId: "mrms-rotation", label: "Rotation track, 60 min (MRMS)", short: "ROT", group: "Radar (national)" },
  "mrms-vil": { id: "mrms-vil", kind: "server", serverId: "mrms-vil", label: "VIL (MRMS)", short: "VIL", group: "Radar (national)" },
  "intl-eccc": intl("intl-eccc", "eccc", "CAN"),
  "intl-dwd": intl("intl-dwd", "dwd", "DEU"),
  "intl-fmi": intl("intl-fmi", "fmi", "FIN"),
  "intl-knmi": intl("intl-knmi", "knmi", "NLD"),
  "intl-jma": intl("intl-jma", "jma", "JPN"),
  "sat-vis": { id: "sat-vis", kind: "gibs", layer: "ABI_Band2_Red_Visible_1km", label: "Visible (ABI band 2)", short: "VIS", group: "Satellite", maxzoom: 8 },
  "sat-ir": { id: "sat-ir", kind: "gibs", layer: "ABI_Band13_Clean_Infrared", label: "Clean IR (ABI band 13)", short: "IR", group: "Satellite", maxzoom: 7 },
  "sat-wv": { id: "sat-wv", kind: "nowcoast", layer: "goes_water_vapor_imagery", label: "Water Vapor (latest)", short: "WV", group: "Satellite" },
  "sat-airmass": { id: "sat-airmass", kind: "gibs", layer: "ABI_Air_Mass", label: "Air Mass RGB", short: "AIRMASS", group: "Satellite", maxzoom: 7 },
  "sat-geocolor": { id: "sat-geocolor", kind: "gibs", layer: "ABI_GeoColor", label: "GeoColor", short: "GEOCOLOR", group: "Satellite", maxzoom: 8 },
  "sat-dust": { id: "sat-dust", kind: "gibs", layer: "ABI_Dust", label: "Dust RGB", short: "DUST", group: "Satellite", maxzoom: 7 },
  "sat-firetemp": { id: "sat-firetemp", kind: "gibs", layer: "ABI_FireTemp", label: "Fire Temperature RGB", short: "FIRE", group: "Satellite", maxzoom: 7 },
  "goes-dcp": { id: "goes-dcp", kind: "server", serverId: "goes-dcp", label: "Day Cloud Phase Distinction", short: "DCP", group: "Satellite" },
  "goes-nightmicro": { id: "goes-nightmicro", kind: "server", serverId: "goes-nightmicro", label: "Night Fog (Nighttime Microphysics)", short: "NFOG", group: "Satellite" },
  "goes-sandwich": { id: "goes-sandwich", kind: "server", serverId: "goes-sandwich", label: "IR Sandwich", short: "SANDWICH", group: "Satellite" },
};

/** The Level III product code for a pane, or null when it uses tiles or another source. */
export function l3CodeFor(id: ProProductId, tilt: string): string | null {
  const p = PRO_PRODUCTS[id];
  if (p.kind === "l3") return p.code ?? `${tilt}${p.letter}`;
  if (p.kind === "site" && p.l3Letter && tilt !== "N0") return `${tilt}${p.l3Letter}`;
  return null;
}

/** GIBS only carries the RGB composites for GOES-East (which still covers the CONUS). */
const EAST_ONLY = new Set(["ABI_Air_Mass", "ABI_GeoColor", "ABI_Dust", "ABI_FireTemp"]);

export const isSatellite = (id: ProProductId) => PRO_PRODUCTS[id].group === "Satellite";

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

/**
 * Whether a product works on this device: Level II volumes need a desktop
 * (`volume`), and the Pro data server's products need a server to be set up.
 * Products that don't are left out of the menus.
 */
export function productUsable(id: ProProductId, caps: { volume: boolean }): boolean {
  const p = PRO_PRODUCTS[id];
  if (p.kind === "l2") return caps.volume;
  if (p.kind === "server") return !!PRO_SERVER;
  return true;
}

/** What a saved panel shows when its product doesn't work here: the nearest product that does. */
const STAND_IN: Partial<Record<ProProductId, ProProductId>> = {
  "vol-ref": "ref",
  "vol-vel": "vel",
  "vol-zdr": "zdr",
  "vol-cc": "cc",
  "mrms-mesh": "cref",
  "mrms-mesh60": "cref",
  "mrms-rotation": "vel",
  "mrms-vil": "vil",
  "goes-dcp": "sat-vis",
  "goes-nightmicro": "sat-ir",
  "goes-sandwich": "sat-ir",
};

export function shownProduct(id: ProProductId, caps: { volume: boolean }): ProProductId {
  return productUsable(id, caps) ? id : (STAND_IN[id] ?? "ref");
}
