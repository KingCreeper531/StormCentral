/**
 * Cursor sampling for raster products: which tile pixel sits under a lat/lon,
 * and what value its colour stands for.
 *
 * The tile services hand out rendered PNGs, not data (NOAA's GetFeatureInfo
 * answers with colours), so the value is read back from the colour: the
 * pixel is matched to the nearest point on the colour scale that drew it
 * (lib/pro/scales.ts), interpolating between stops. Tiles are resampled when
 * rendered, so values are shown as approximate (≈). Exact gate values need
 * the Level-II/III files themselves (see the README's Professional-mode
 * notes).
 */
import type { LegendStop } from "../radar/products";

const ORIGIN_SHIFT = 20037508.342789244;

/** Web-Mercator pixel position of a point in a `tileSize` pyramid at zoom `z`. */
export function pixelAt(lon: number, lat: number, z: number, tileSize: number) {
  const world = tileSize * 2 ** z;
  const φ = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const x = ((lon + 180) / 360) * world;
  const y = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * world;
  const tx = Math.floor(x / tileSize);
  const ty = Math.floor(y / tileSize);
  return { tx, ty, px: Math.min(tileSize - 1, Math.floor(x - tx * tileSize)), py: Math.min(tileSize - 1, Math.floor(y - ty * tileSize)) };
}

/** EPSG:3857 bounds of tile (z, x, y) as MapLibre fills `{bbox-epsg-3857}`. */
export function tileBbox(z: number, x: number, y: number): string {
  const size = (2 * ORIGIN_SHIFT) / 2 ** z;
  const minx = -ORIGIN_SHIFT + x * size;
  const maxy = ORIGIN_SHIFT - y * size;
  return `${minx},${maxy - size},${minx + size},${maxy}`;
}

export function fillTileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)).replace("{bbox-epsg-3857}", tileBbox(z, x, y));
}

/**
 * The tile zoom MapLibre loads for a map zoom: map zoom counts 512 px tiles,
 * so 256 px sources load one level deeper. Capped at the source's maxzoom.
 */
export function tileZoom(mapZoom: number, tileSize: number, maxzoom: number): number {
  return Math.max(0, Math.min(maxzoom, Math.floor(mapZoom) + (tileSize === 256 ? 1 : 0)));
}

type Rgb = readonly [number, number, number];

function hexRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Stops in ascending order (a legend's trailing out-of-order entries are dropped). */
function ascending(stops: readonly LegendStop[]): { value: number; rgb: Rgb }[] {
  const out: { value: number; rgb: Rgb }[] = [];
  for (const s of stops) if (!out.length || s.value > out.at(-1)!.value) out.push({ value: s.value, rgb: hexRgb(s.color) });
  return out;
}

export interface ColorMatch {
  value: number;
  /** RGB distance from the scale (0 = exactly on it); large means the colour isn't from this scale. */
  distance: number;
}

/**
 * Value of a colour on a scale: the closest point on the piecewise-linear
 * path through the stops' colours. `categorical` scales (hydrometeor class)
 * snap to the nearest stop instead.
 */
export function valueFromColor(rgb: Rgb, stops: readonly LegendStop[], categorical = false): ColorMatch | null {
  const s = ascending(stops);
  if (!s.length) return null;
  const d2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  if (categorical || s.length === 1) {
    let best = s[0]!;
    for (const x of s) if (d2(x.rgb, rgb) < d2(best.rgb, rgb)) best = x;
    return { value: best.value, distance: Math.sqrt(d2(best.rgb, rgb)) };
  }
  let bestValue = s[0]!.value;
  let bestD = Infinity;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]!.rgb;
    const b = s[i + 1]!.rgb;
    const ab: Rgb = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = len ? Math.max(0, Math.min(1, ((rgb[0] - a[0]) * ab[0] + (rgb[1] - a[1]) * ab[1] + (rgb[2] - a[2]) * ab[2]) / len)) : 0;
    const p: Rgb = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
    const d = d2(p, rgb);
    if (d < bestD) {
      bestD = d;
      bestValue = s[i]!.value + t * (s[i + 1]!.value - s[i]!.value);
    }
  }
  return { value: bestValue, distance: Math.sqrt(bestD) };
}

/** Colours further than this from every point on the scale aren't read as values. */
export const MAX_COLOR_DISTANCE = 90;

// ── Tile pixel reads (browser only) ─────────────────────────────────────────

const CACHE_SIZE = 48;
/** url → decoded tile pixels (or the pending decode). Least-recently-used first. */
const tiles = new Map<string, Promise<ImageData | null>>();

async function decode(url: string, signal?: AbortSignal): Promise<ImageData | null> {
  const res = await fetch(url, { mode: "cors", credentials: "omit", signal });
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function tileData(url: string, signal?: AbortSignal): Promise<ImageData | null> {
  const hit = tiles.get(url);
  if (hit) {
    tiles.delete(url);
    tiles.set(url, hit);
    return hit;
  }
  const p = decode(url, signal).catch(() => null);
  tiles.set(url, p);
  // Failed reads aren't cached: the next hover retries.
  void p.then((d) => d || tiles.delete(url));
  while (tiles.size > CACHE_SIZE) tiles.delete(tiles.keys().next().value!);
  return p;
}

export interface PixelSource {
  tileUrl: string;
  tileSize: number;
  maxzoom: number;
}

/** RGBA under a point in a frame's tiles; null if the tile can't be read. */
export async function samplePixel(src: PixelSource, lon: number, lat: number, mapZoom: number, signal?: AbortSignal): Promise<[number, number, number, number] | null> {
  const z = tileZoom(mapZoom, src.tileSize, src.maxzoom);
  const { tx, ty, px, py } = pixelAt(lon, lat, z, src.tileSize);
  const data = await tileData(fillTileUrl(src.tileUrl, z, tx, ty), signal);
  if (!data) return null;
  // The service may return a different size than requested (e.g. @2x): scale into it.
  const sx = Math.min(data.width - 1, Math.floor((px * data.width) / src.tileSize));
  const sy = Math.min(data.height - 1, Math.floor((py * data.height) / src.tileSize));
  const i = (sy * data.width + sx) * 4;
  return [data.data[i]!, data.data[i + 1]!, data.data[i + 2]!, data.data[i + 3]!];
}
