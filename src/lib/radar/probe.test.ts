import { describe, expect, it } from "vitest";
import { FAMILIES } from "./products";
import { reflectivityLabel, tilePixel, valueFromColor } from "./probe";

describe("radar probe", () => {
  it("finds the tile and pixel under a point", () => {
    expect(tilePixel(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0, px: 128, py: 128 });
    const p = tilePixel(-97.44, 35.22, 8);
    expect(p).toMatchObject({ z: 8, x: 58, y: 101 });
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThan(256);
  });

  it("reads dBZ back from legend colours, including in-between shades", () => {
    const legend = FAMILIES.reflectivity.legend;
    expect(valueFromColor(0xfd, 0x00, 0x00, legend)).toBe(50);
    const mid = valueFromColor(0xf1, 0xda, 0x01, legend)!; // halfway between 35 (#fdf802) and 40 (#e5bc00)
    expect(mid).toBeGreaterThan(36);
    expect(mid).toBeLessThan(39);
    expect(valueFromColor(30, 30, 30, legend)).toBeNull();
  });

  it("describes intensity", () => {
    expect(reflectivityLabel(10)).toMatch(/light/i);
    expect(reflectivityLabel(58)).toMatch(/hail/);
  });
});
