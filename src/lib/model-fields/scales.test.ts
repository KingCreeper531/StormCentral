import { describe, expect, it } from "vitest";
import { UNIT_PRESETS } from "../weather/units";
import { colorAt, FIELDS, isModelFieldSetting, legendGradient, legendPosition, legendUnit, legendValue, MODEL_FIELDS, writeColor } from "./scales";

describe("model field colour scales", () => {
  it("run in ascending order with legend ticks inside the scale", () => {
    for (const id of MODEL_FIELDS) {
      const { stops, ticks } = FIELDS[id];
      for (let i = 1; i < stops.length; i++) expect(stops[i]!.value).toBeGreaterThan(stops[i - 1]!.value);
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(stops[0]!.value);
        expect(t).toBeLessThanOrEqual(stops[stops.length - 1]!.value);
      }
    }
  });

  it("hit each stop exactly and blend between them", () => {
    const { stops } = FIELDS.temp;
    expect(colorAt(stops, 0)).toEqual([...stops.find((s) => s.value === 0)!.color]);
    const mid = colorAt(stops, 2.5);
    const a = stops.find((s) => s.value === 0)!.color;
    const b = stops.find((s) => s.value === 5)!.color;
    for (let k = 0; k < 4; k++) expect(mid[k]).toBe(Math.round((a[k]! + b[k]!) / 2));
  });

  it("hold the end colours beyond the scale", () => {
    const { stops } = FIELDS.wind;
    expect(colorAt(stops, -5)).toEqual([...stops[0]!.color]);
    expect(colorAt(stops, 99)).toEqual([...stops[stops.length - 1]!.color]);
  });

  it("leave dry, calm and missing places clear", () => {
    expect(colorAt(FIELDS.precip.stops, 0)[3]).toBe(0);
    expect(colorAt(FIELDS.snow.stops, 0)[3]).toBe(0);
    expect(colorAt(FIELDS.cape.stops, 10)[3]).toBe(0);
    expect(colorAt(FIELDS.temp.stops, Number.NaN)).toEqual([0, 0, 0, 0]);
    expect(colorAt(FIELDS.precip.stops, 5)[3]).toBeGreaterThan(200);
  });

  it("write into an image buffer at an offset", () => {
    const buf = new Uint8ClampedArray(8);
    writeColor(FIELDS.temp.stops, 20, buf, 4);
    expect([...buf.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...buf.slice(4)]).toEqual([...FIELDS.temp.stops.find((s) => s.value === 20)!.color]);
  });

  it("space the legend evenly by stop", () => {
    const { stops } = FIELDS.precip;
    expect(legendPosition(stops, stops[0]!.value)).toBe(0);
    expect(legendPosition(stops, 40)).toBe(1);
    expect(legendPosition(stops, 1)).toBeCloseTo(2 / (stops.length - 1));
    expect(legendGradient(stops)).toMatch(/^linear-gradient\(90deg, rgba\(.+ 0\.0%, .+ 100\.0%\)$/);
  });

  it("label the legend in the person's units", () => {
    const us = UNIT_PRESETS.imperial;
    const metric = UNIT_PRESETS.metric;
    expect(legendValue(FIELDS.temp, 0, us)).toBe("32");
    expect(legendValue(FIELDS.temp, -10, metric)).toBe("-10");
    expect(legendValue(FIELDS.wind, 10, us)).toBe("22");
    expect(legendUnit(FIELDS.gusts, metric)).toBe("km/h");
    expect(legendValue(FIELDS.precip, 0.2, metric)).toBe("0.2");
    expect(legendValue(FIELDS.precip, 20, us)).toBe("0.8");
    expect(legendUnit(FIELDS.precip, us)).toBe("in/h");
    expect(legendValue(FIELDS.snow, 2, us)).toBe("0.8");
    expect(legendUnit(FIELDS.snow, metric)).toBe("cm/h");
    expect(legendValue(FIELDS.cape, 2000, us)).toBe("2000");
  });

  it("recognise saved settings", () => {
    expect(isModelFieldSetting("off")).toBe(true);
    expect(isModelFieldSetting("cape")).toBe(true);
    expect(isModelFieldSetting("rain")).toBe(false);
    expect(isModelFieldSetting(undefined)).toBe(false);
  });
});
