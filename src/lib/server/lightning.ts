import "server-only";
import { inflateSync } from "node:zlib";
import { LIGHTNING_WMS } from "../radar/lightning";

/**
 * "Is there lightning near this point?" for the web and the Windows app
 * (Android answers natively, in AlertsWorker.java). nowCOAST's strike-density
 * layer is fetched as a small PNG around the point; any visible pixel is a
 * grid cell with strikes in the last 15 minutes.
 */

const SIZE = 64;

export interface AlphaGrid {
  width: number;
  height: number;
  /** One byte per pixel: 0 is transparent. */
  alpha: Uint8Array;
}

/**
 * Reads the alpha of an 8-bit, non-interlaced PNG: palette (with tRNS, which
 * nowCOAST sends), RGBA, grey+alpha, RGB or grey. Throws on anything else.
 */
export function decodePngAlpha(png: Uint8Array): AlphaGrid {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let colorType = -1;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let i = 8; i + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    i += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9]!;
      if (depth !== 8 || data[12] !== 0) throw new Error("unsupported PNG (needs 8-bit, non-interlaced)");
    } else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!bpp || !width || !height || width * height > 1 << 20) throw new Error("unsupported PNG");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new Error("truncated PNG");
  const alpha = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start]!;
    const line = Uint8Array.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x]! + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const px = x * bpp;
      let v = 255;
      if (colorType === 3) v = trns && line[px]! < trns.length ? trns[line[px]!]! : 255;
      else if (colorType === 6) v = line[px + 3]!;
      else if (colorType === 4) v = line[px + 1]!;
      alpha[y * width + x] = v;
    }
    prev = line;
  }
  return { width, height, alpha };
}

/** Distance (km) from the centre to the nearest visible pixel of a grid spanning 2·radiusKm, or null. */
export function nearestLit(grid: AlphaGrid, radiusKm: number): number | null {
  const kmPerPx = (2 * radiusKm) / grid.width;
  let best = Infinity;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.alpha[y * grid.width + x]! < 16) continue;
      const dx = (x + 0.5 - grid.width / 2) * kmPerPx;
      const dy = (y + 0.5 - grid.height / 2) * kmPerPx;
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best <= radiusKm ? best : null;
}

/** The WMS request for a square of side 2·radiusKm (in Web Mercator, which stretches by 1/cos(lat)). */
export function lightningBoxUrl(lat: number, lon: number, radiusKm: number, slot: number): string {
  const R = 6378137;
  const half = (radiusKm * 1000) / Math.cos((lat * Math.PI) / 180);
  const x = ((lon * Math.PI) / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;
  const bbox = [x - half, y - half, x + half, y + half].map((v) => v.toFixed(0)).join(",");
  return (
    `${LIGHTNING_WMS}?service=WMS&version=1.3.0&request=GetMap&layers=ldn_lightning_strike_density&styles=` +
    `&format=image/png&transparent=true&crs=EPSG:3857&width=${SIZE}&height=${SIZE}&bbox=${bbox}&_=${slot}`
  );
}

export async function nearestLightningKm(lat: number, lon: number, radiusKm: number, signal?: AbortSignal): Promise<number | null> {
  const res = await fetch(lightningBoxUrl(lat, lon, radiusKm, Math.floor(Date.now() / 300_000)), { signal, headers: { Accept: "image/png" } });
  if (!res.ok) throw new Error(`nowCOAST answered ${res.status}`);
  if (!(res.headers.get("content-type") ?? "").includes("image/png")) throw new Error("nowCOAST didn't return an image");
  return nearestLit(decodePngAlpha(new Uint8Array(await res.arrayBuffer())), radiusKm);
}
