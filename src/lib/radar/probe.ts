/**
 * Reading a value back out of a rendered radar tile: tap the map, sample the
 * tile's pixel, and match its colour against the product's legend. IEM tiles
 * are pre-coloured PNGs, so this is an estimate (to about half a legend step),
 * like the reticle readout in dedicated radar apps.
 */
import type { LegendStop } from "./products";

export interface TilePixel {
  z: number;
  x: number;
  y: number;
  /** Pixel inside the 256 px tile. */
  px: number;
  py: number;
}

/** Web Mercator tile and pixel under a point at zoom z. */
export function tilePixel(lon: number, lat: number, z: number, size = 256): TilePixel {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const fx = ((((lon + 180) / 360) % 1) + 1) % 1 * n;
  const r = (clampedLat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.floor(fx));
  const y = Math.min(n - 1, Math.max(0, Math.floor(fy)));
  return { z, x, y, px: Math.min(size - 1, Math.floor((fx - x) * size)), py: Math.min(size - 1, Math.max(0, Math.floor((fy - y) * size))) };
}

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/**
 * The legend value whose colour is nearest to (r, g, b), interpolating along
 * each pair of neighbouring stops. Returns null when nothing is close.
 */
export function valueFromColor(r: number, g: number, b: number, legend: readonly LegendStop[]): number | null {
  if (!legend.length) return null;
  let best = { d: Infinity, v: legend[0]!.value };
  const consider = (d: number, v: number) => {
    if (d < best.d) best = { d, v };
  };
  for (let i = 0; i < legend.length; i++) {
    const a = rgb(legend[i]!.color);
    consider(Math.hypot(r - a[0], g - a[1], b - a[2]), legend[i]!.value);
    const next = legend[i + 1];
    if (!next) continue;
    const c = rgb(next.color);
    const seg = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const len2 = seg[0]! ** 2 + seg[1]! ** 2 + seg[2]! ** 2;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((r - a[0]) * seg[0]! + (g - a[1]) * seg[1]! + (b - a[2]) * seg[2]!) / len2));
    const p = [a[0] + t * seg[0]!, a[1] + t * seg[1]!, a[2] + t * seg[2]!];
    consider(Math.hypot(r - p[0]!, g - p[1]!, b - p[2]!), legend[i]!.value + t * (next.value - legend[i]!.value));
  }
  // Basemap-coloured or anti-aliased pixels: too far from any legend colour.
  return best.d <= 90 ? best.v : null;
}

/** Plain-language intensity for reflectivity (dBZ). */
export function reflectivityLabel(dbz: number): string {
  if (dbz < 20) return "Very light: drizzle, flurries or mist";
  if (dbz < 35) return "Light to moderate";
  if (dbz < 45) return "Moderate to heavy";
  if (dbz < 55) return "Heavy, small hail possible";
  if (dbz < 65) return "Very heavy, hail likely";
  return "Intense, large hail possible";
}

/**
 * Browser only: the RGBA under a point in a radar frame's tiles, taking the
 * most opaque pixel in a 3×3 patch so a tap between gates still reads.
 */
export async function samplePixel(tileUrl: string, maxzoom: number, lon: number, lat: number, mapZoom: number, signal?: AbortSignal) {
  const z = Math.max(0, Math.min(maxzoom, Math.round(mapZoom)));
  const t = tilePixel(lon, lat, z);
  const url = tileUrl.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
  const res = await fetch(url, { signal, credentials: "omit" });
  if (!res.ok) throw new Error(`tile ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const scale = canvas.width / 256;
  const cx = Math.round(t.px * scale);
  const cy = Math.round(t.py * scale);
  const x0 = Math.max(0, cx - 1);
  const y0 = Math.max(0, cy - 1);
  const data = ctx.getImageData(x0, y0, Math.min(3, canvas.width - x0), Math.min(3, canvas.height - y0)).data;
  let best: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > best[3]) best = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
  return best;
}
