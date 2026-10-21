/**
 * Lightning: NOAA nowCOAST lightning strike density (layer ldn_lightning_strike_density; ground-based network,
 * 15-minute windows, ~8 km grid), served by nowCOAST's GeoServer as WMS.
 * NOAA notes it is not meant for lightning-safety decisions: it is coarse and
 * a few minutes behind.
 */
export const LIGHTNING_WMS = "https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows";
export const LIGHTNING_ATTRIBUTION = "Lightning: NOAA nowCOAST";
/** nowCOAST updates the density grid every 15 minutes; refresh a little more often. */
export const LIGHTNING_REFRESH_MS = 5 * 60_000;

/** WMS GetMap template for MapLibre (`{bbox-epsg-3857}` is filled per tile). `slot` busts caches between updates. */
export function lightningTileUrl(slot: number): string {
  const q = [
    "service=WMS",
    "version=1.3.0",
    "request=GetMap",
    "layers=ldn_lightning_strike_density",
    "styles=",
    "format=image/png",
    "transparent=true",
    "crs=EPSG:3857",
    "width=256",
    "height=256",
    "bbox={bbox-epsg-3857}",
    `_=${slot}`,
  ].join("&");
  return `${LIGHTNING_WMS}?${q}`;
}

// ── Bolts ───────────────────────────────────────────────────────────────────
// Lightning is drawn as a bolt per flash: GOES GLM flashes, which the app's
// own server reads from NOAA's open data (GET /api/lightning/flashes,
// src/lib/server/glm.ts). The density grid above only says which ~8 km
// squares had strikes, not where in them, so it's shown as it is (not as
// bolts, which would line up in rows) only when the flashes can't be had.

/** [west, south, east, north], degrees. */
export type Bbox = readonly [west: number, south: number, east: number, north: number];

export interface LightningFile {
  generated: string;
  minutes: number;
  /** [lon, lat, seconds before `generated`], oldest first. */
  flashes: [number, number, number][];
}

/** `?bbox=w,s,e,n` → the area, or null when it isn't a valid one. */
export function parseBbox(raw: string | null): Bbox | null {
  const v = (raw ?? "").split(",").map((p) => (p.trim() === "" ? NaN : Number(p)));
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  const [w, s, e, n] = v as [number, number, number, number];
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  return [w, s, e, n];
}

/**
 * The flashes to ask for around a map view: its bounds widened to whole 10°
 * squares, so panning a little asks again only past a square's edge and
 * nearby viewers share cached answers. A view across the date line, or wider
 * than the world, asks for every longitude.
 */
export function flashesBbox(west: number, south: number, east: number, north: number): Bbox {
  const down = (v: number) => Math.floor(v / 10) * 10;
  const up = (v: number) => Math.ceil(v / 10) * 10;
  const s = Math.max(-90, down(south));
  const n = Math.min(90, Math.max(s + 10, up(north)));
  if (east - west >= 360 || west < -180 || east > 180) return [-180, s, 180, n];
  const w = down(west);
  return [w, s, Math.min(180, Math.max(w + 10, up(east))), n];
}

/** The app's flashes for an area (GET /api/lightning/flashes). */
export const flashesUrl = (bbox: Bbox) => `/api/lightning/flashes?bbox=${bbox.join(",")}`;

/** A flash as a map point, `age` seconds old. */
export interface Bolt {
  lon: number;
  lat: number;
  age: number;
}

/** The flashes of a lightning.json still inside its window at `now`. */
export function boltsFromFile(file: LightningFile, now = Date.now()): Bolt[] {
  const generated = Date.parse(file.generated);
  if (!Number.isFinite(generated) || !Array.isArray(file.flashes)) return [];
  const lag = Math.max(0, (now - generated) / 1000);
  const max = (Number(file.minutes) || 15) * 60;
  const out: Bolt[] = [];
  for (const f of file.flashes) {
    const [lon, lat, ago] = f;
    const age = ago + lag;
    if (Number.isFinite(lon) && Number.isFinite(lat) && age <= max) out.push({ lon, lat, age: Math.round(age) });
  }
  return out;
}
