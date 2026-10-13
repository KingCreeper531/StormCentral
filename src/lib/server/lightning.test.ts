import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePngAlpha, lightningBoxUrl, nearestLit } from "./lightning";

/** A palette PNG like nowCOAST's: index 0 transparent, `lit` pixels set to index 1. */
function palettePng(w: number, h: number, lit: [number, number][], filter = 0): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]); // CRC isn't checked
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(filter);
    const line = Array.from({ length: w }, (_, x) => (lit.some(([lx, ly]) => lx === x && ly === y) ? 1 : 0));
    // Filter 1 (Sub) stores differences from the pixel to the left.
    rows.push(...line.map((v, x) => (filter === 1 ? (v - (x ? line[x - 1]! : 0) + 256) & 255 : v)));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", Buffer.from([0, 0, 0, 255, 255, 0])),
    chunk("tRNS", Buffer.from([0, 255])),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("lightning near a point", () => {
  it("decodes nowCOAST-style palette PNGs, including filtered rows", () => {
    for (const filter of [0, 1]) {
      const g = decodePngAlpha(palettePng(8, 4, [[2, 1], [7, 3]], filter));
      expect(g.width).toBe(8);
      expect([...g.alpha].filter((a) => a > 0)).toHaveLength(2);
      expect(g.alpha[1 * 8 + 2]).toBe(255);
      expect(g.alpha[0]).toBe(0);
    }
    expect(() => decodePngAlpha(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("finds the nearest lit cell within the radius", () => {
    // 64 px over 32 km: 0.5 km per pixel; pixel (40, 32) is 4.25 km east and 0.25 km south of centre.
    const g = decodePngAlpha(palettePng(64, 64, [[40, 32], [63, 63]]));
    expect(nearestLit(g, 16)).toBeCloseTo(Math.hypot(4.25, 0.25), 6);
    expect(nearestLit(decodePngAlpha(palettePng(64, 64, [[0, 0]])), 16)).toBeNull(); // the corner is outside the circle
    expect(nearestLit(decodePngAlpha(palettePng(64, 64, [])), 16)).toBeNull();
  });

  it("asks for the right layer and a square box", () => {
    const url = lightningBoxUrl(35.2, -97.4, 16, 1);
    expect(url).toContain("layers=ldn_lightning_strike_density");
    const bbox = new URL(url).searchParams.get("bbox")!.split(",").map(Number);
    expect(bbox[2]! - bbox[0]!).toBeCloseTo(bbox[3]! - bbox[1]!, -1);
  });
});
