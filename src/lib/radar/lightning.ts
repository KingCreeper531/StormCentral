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
// Lightning is drawn as a bolt per flash: GOES GLM flashes from the Pro data
// server (lightning.json, pro-server/pro_server/glm.py) when there is one,
// otherwise a bolt on each cell of the density grid above.

/** Ages (seconds) where a bolt changes colour: newer is brighter. */
export const BOLT_AGES = [120, 300, 600] as const;
/** Bolt colours from newest to oldest (density-grid bolts, whose age isn't known, take the second). */
export const BOLT_COLORS = ["#ffffff", "#ffd60a", "#ff9f1c", "#ef4444"] as const;

export interface LightningFile {
  generated: string;
  minutes: number;
  /** [lon, lat, seconds before `generated`, energy fJ], oldest first. */
  flashes: [number, number, number, number][];
}

/** A flash as a map point: `age` in seconds now (-1 for density-grid bolts, whose age isn't known). */
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

/** Web Mercator metres → degrees. */
const toLon = (x: number) => (x / 20037508.342789244) * 180;
const toLat = (y: number) => (Math.atan(Math.exp((y / 20037508.342789244) * Math.PI)) * 360) / Math.PI - 90;

/**
 * Bolts from a density-grid image (RGBA, `width` × `height`, covering the
 * EPSG:3857 box `[minX, minY, maxX, maxY]`): one per `cell` × `cell` block of
 * pixels with any lightning, at its most opaque pixel.
 */
export function boltsFromDensity(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, box: readonly [number, number, number, number], cell: number): Bolt[] {
  const out: Bolt[] = [];
  const [minX, minY, maxX, maxY] = box;
  for (let cy = 0; cy < height; cy += cell) {
    for (let cx = 0; cx < width; cx += cell) {
      let best = 0;
      let bx = 0;
      let by = 0;
      for (let y = cy; y < Math.min(height, cy + cell); y++) {
        for (let x = cx; x < Math.min(width, cx + cell); x++) {
          const a = rgba[(y * width + x) * 4 + 3]!;
          if (a > best) [best, bx, by] = [a, x, y];
        }
      }
      // Faint anti-aliased edges aren't a cell of their own.
      if (best < 64) continue;
      const lon = toLon(minX + ((bx + 0.5) / width) * (maxX - minX));
      const lat = toLat(maxY - ((by + 0.5) / height) * (maxY - minY));
      out.push({ lon, lat, age: -1 });
    }
  }
  return out;
}

/** One GetMap of the density grid for a view (EPSG:3857 box), `width` × `height` px. */
export function lightningImageUrl(box: readonly [number, number, number, number], width: number, height: number, slot: number): string {
  return lightningTileUrl(slot).replace("width=256", `width=${width}`).replace("height=256", `height=${height}`).replace("{bbox-epsg-3857}", box.map((v) => v.toFixed(0)).join(","));
}
