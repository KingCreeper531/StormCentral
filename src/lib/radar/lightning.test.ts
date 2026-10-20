import { describe, expect, it } from "vitest";
import { boltsFromDensity, boltsFromFile, lightningImageUrl } from "./lightning";

describe("lightning bolts", () => {
  it("ages GLM flashes from the file's time and drops the expired", () => {
    const file = { generated: "2026-10-20T18:48:53Z", minutes: 15, flashes: [[-97.5, 35.3, 890, 12], [-96, 36, 30, 4], [Number.NaN, 1, 1, 1]] as [number, number, number, number][] };
    const now = Date.parse(file.generated) + 20_000;
    expect(boltsFromFile(file, now)).toEqual([{ lon: -96, lat: 36, age: 50 }]);
    expect(boltsFromFile({ ...file, generated: "nope" }, now)).toEqual([]);
  });

  it("puts one bolt on each block of the density grid with lightning", () => {
    const w = 8;
    const h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number, a: number) => (rgba[(y * w + x) * 4 + 3] = a);
    set(1, 1, 255); // block (0,0)
    set(2, 2, 120); // same block, fainter
    set(6, 0, 30); // block (4,0): too faint
    set(5, 3, 200); // block (4,0)
    const box = [-1e6, -5e5, 1e6, 5e5] as const;
    const bolts = boltsFromDensity(rgba, w, h, box, 4);
    expect(bolts).toHaveLength(2);
    // Pixel (1,1)'s centre: x = -1e6 + 1.5/8 · 2e6.
    expect(bolts[0]!.lon).toBeCloseTo(((-1e6 + (1.5 / 8) * 2e6) / 20037508.342789244) * 180, 6);
    expect(bolts[0]!.lat).toBeGreaterThan(0);
    expect(bolts[1]!.lat).toBeLessThan(0);
    expect(bolts.every((b) => b.age === -1)).toBe(true);
  });

  it("asks for the density grid over the view", () => {
    const url = lightningImageUrl([-1e7, 3e6, -8e6, 5e6], 300, 200, 7);
    expect(url).toContain("width=300&height=200");
    expect(url).toContain("bbox=-10000000,3000000,-8000000,5000000");
    expect(url).toContain("_=7");
  });
});
