/**
 * GOES satellite imagery from NASA GIBS, looped in step with the radar.
 *
 * Tiles come from GIBS's Web Mercator WMS rather than WMTS: MapLibre fills in
 * `{bbox-epsg-3857}` per 256 px tile, so we never need each layer's WMTS
 * tile-matrix set. The ABI layers update every 10 minutes and appear ~15–30
 * minutes after scan time, so each radar frame maps to the 10-minute slot a
 * fixed latency margin before it. Several radar frames share a slot, which is
 * what keeps a 12-frame loop down to ~6 satellite images.
 */
import { clockIn } from "../weather/view";

export type SatBand = "infrared" | "visible";
export type GoesSat = "east" | "west";

export const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
export const SATELLITE_ATTRIBUTION = "GOES imagery: NASA GIBS / NOAA";
/** ABI full-disk / CONUS imagery cadence in GIBS. */
export const SLOT_MS = 10 * 60_000;
/** How far behind scan time GIBS imagery reliably exists. */
export const DEFAULT_LATENCY_MIN = 20;
/** Most satellite images held at once (each is a full viewport of textures). */
export const MAX_SLOTS = 8;
/** Views centred west of this longitude use GOES-West. */
export const WEST_OF_LON = -115;
/** Degrees past the line before switching back, so a view parked on it doesn't flap. */
const HYSTERESIS_DEG = 2;
/** Beyond this (the far side of the Pacific), GOES-West is the nearer satellite. */
const FAR_SIDE_LON = 75;

const LAYERS: Record<SatBand, string> = {
  infrared: "ABI_Band13_Clean_Infrared",
  visible: "ABI_Band2_Red_Visible_1km",
};

/** Epoch ms of the satellite image to pair with a radar frame at `ms`. */
export function satelliteSlot(ms: number, latencyMin = DEFAULT_LATENCY_MIN): number {
  return Math.floor((ms - latencyMin * 60_000) / SLOT_MS) * SLOT_MS;
}

/** GIBS layer identifier, e.g. `GOES-East_ABI_Band13_Clean_Infrared`. */
export function satelliteLayerName(band: SatBand, sat: GoesSat): string {
  return `GOES-${sat === "west" ? "West" : "East"}_${LAYERS[band]}`;
}

/** `2026-10-07T14:20:00Z` (GIBS rejects fractional seconds). */
export function gibsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * WMS GetMap template for a MapLibre raster source. Built by hand: URL
 * encoding would turn `{bbox-epsg-3857}` into `%7B…%7D` and MapLibre would no
 * longer substitute it.
 */
export function satelliteTileUrl(band: SatBand, sat: GoesSat, slotMs: number): string {
  const params = [
    "SERVICE=WMS",
    "REQUEST=GetMap",
    "VERSION=1.3.0",
    `LAYERS=${satelliteLayerName(band, sat)}`,
    "STYLES=",
    "FORMAT=image/png",
    "TRANSPARENT=TRUE",
    "CRS=EPSG:3857",
    "WIDTH=256",
    "HEIGHT=256",
    "BBOX={bbox-epsg-3857}",
    `TIME=${gibsTime(slotMs)}`,
  ];
  return `${GIBS_WMS}?${params.join("&")}`;
}

/** Highest zoom worth requesting: Band 13 is 2 km data, Band 2 is 1 km (0.5 km native). */
export function satelliteMaxzoom(band: SatBand): number {
  return band === "visible" ? 8 : 7;
}

/**
 * GOES-West for views centred west of ~115°W (and across the date line),
 * GOES-East otherwise. Pass the current choice as `prev` to only switch once
 * the centre is a couple of degrees past the line.
 */
export function pickSatellite(lon: number, prev?: GoesSat): GoesSat {
  if (!Number.isFinite(lon)) return prev ?? "east";
  const x = ((((lon + 180) % 360) + 360) % 360) - 180; // wrap to [-180, 180)
  const margin = prev ? HYSTERESIS_DEG : 0;
  // Positive margin when leaving `prev` means the line must be cleared by that much.
  if (prev === "west") return x < WEST_OF_LON + margin || x > FAR_SIDE_LON - margin ? "west" : "east";
  return x < WEST_OF_LON - margin || x > FAR_SIDE_LON + margin ? "west" : "east";
}

/** Distinct satellite slots for a set of radar frame times, oldest → newest, newest `max` kept. */
export function slotsFor(times: readonly number[], latencyMin = DEFAULT_LATENCY_MIN, max = MAX_SLOTS): number[] {
  const set = new Set<number>();
  for (const t of times) if (Number.isFinite(t)) set.add(satelliteSlot(t, latencyMin));
  return [...set].sort((a, b) => a - b).slice(-max);
}

/** The held slot closest to `slotMs` (ties go to the older one), or null when none are held. */
export function nearestSlot(slots: readonly number[], slotMs: number): number | null {
  let best: number | null = null;
  for (const s of slots) if (best === null || Math.abs(s - slotMs) < Math.abs(best - slotMs)) best = s;
  return best;
}

/**
 * Caption for the image on screen: "GOES-East infrared, 2:20 PM". Without
 * `sat` it reads "GOES infrared, 2:20 PM".
 */
export function satelliteLabel(band: SatBand, slotMs: number, timeZone: string | undefined, sat?: GoesSat): string {
  const name = sat ? `GOES-${sat === "west" ? "West" : "East"}` : "GOES";
  return `${name} ${band}, ${clockIn(timeZone, slotMs)}`;
}
