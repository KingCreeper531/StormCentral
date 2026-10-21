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
// Lightning is drawn as a bolt per flash when there are flashes: GOES GLM from
// the Pro data server (lightning.json, pro-server/pro_server/glm.py). The
// density grid above only says which ~8 km squares had strikes, not where in
// them, so without flashes the map shows the grid itself rather than bolts
// that would line up in rows.

/** Ages (seconds) where a bolt changes colour: newer is brighter. */
export const BOLT_AGES = [120, 300, 600] as const;
/** Bolt colours from newest to oldest. */
export const BOLT_COLORS = ["#ffffff", "#ffd60a", "#ff9f1c", "#ef4444"] as const;

export interface LightningFile {
  generated: string;
  minutes: number;
  /** [lon, lat, seconds before `generated`, energy fJ], oldest first. */
  flashes: [number, number, number, number][];
}

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
