import { describe, expect, it } from "vitest";
import { bearingDeg, compassPoint, geometryContains, haversineKm, latFromMercatorY, mercatorY } from "./geo";
import { LruCache } from "./lru";
import { nearestIndex } from "./utils";
import { convertPressure, convertTemp, convertWind, defaultUnitsForLocale, formatters, UNIT_PRESETS } from "./weather/units";
import { describeCode, iconName } from "./weather/wmo";

describe("geo", () => {
  it("computes great-circle distance", () => {
    const chicago = { lat: 41.8781, lon: -87.6298 };
    const nyc = { lat: 40.7128, lon: -74.006 };
    expect(haversineKm(chicago, nyc)).toBeGreaterThan(1140);
    expect(haversineKm(chicago, nyc)).toBeLessThan(1150);
    expect(bearingDeg(chicago, nyc)).toBeGreaterThan(90);
    expect(bearingDeg(chicago, nyc)).toBeLessThan(100);
  });

  it("names compass points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(225)).toBe("SW");
    expect(compassPoint(-90)).toBe("W");
  });

  it("tests polygon containment with holes and multipolygons", () => {
    const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
    expect(geometryContains({ type: "Polygon", coordinates: square }, { lat: 2, lon: 2 })).toBe(true);
    expect(geometryContains({ type: "Polygon", coordinates: square }, { lat: 5, lon: 5 })).toBe(false);
    expect(
      geometryContains({ type: "MultiPolygon", coordinates: [square, [[[20, 20], [30, 20], [30, 30], [20, 20]]]] }, { lat: 21, lon: 25 }),
    ).toBe(true);
  });

  it("round-trips mercator", () => {
    expect(latFromMercatorY(mercatorY(51.5))).toBeCloseTo(51.5, 9);
  });
});

describe("LruCache", () => {
  it("evicts least-recently-used entries", () => {
    const evicted: string[] = [];
    const c = new LruCache<number>({ maxEntries: 2, onEvict: (k) => evicted.push(k) });
    c.set("a", 1).set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.keys()).toEqual(["a", "c"]);
    expect(evicted).toEqual(["b"]);
  });

  it("honours byte budgets and TTL", () => {
    let now = 0;
    const c = new LruCache<string>({ maxEntries: 10, maxBytes: 10, sizeOf: (v) => v.length, ttlMs: 100, now: () => now });
    c.set("x", "12345").set("y", "123456");
    expect(c.has("x")).toBe(false);
    expect(c.totalBytes).toBe(6);
    now = 200;
    expect(c.get("y")).toBeUndefined();
    expect(c.size).toBe(0);
  });
});

describe("utils", () => {
  it("finds the nearest index in a sorted series", () => {
    expect(nearestIndex([0, 3600, 7200, 10800], 5000)).toBe(1);
    expect(nearestIndex([0, 3600, 7200, 10800], 6000)).toBe(2);
    expect(nearestIndex([0, 3600], 99999)).toBe(1);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe("units", () => {
  it("converts", () => {
    expect(convertTemp(100, "F")).toBeCloseTo(212);
    expect(convertWind(10, "kn")).toBeCloseTo(19.438, 2);
    expect(convertPressure(1013.25, "inHg")).toBeCloseTo(29.92, 2);
  });

  it("picks regional defaults", () => {
    expect(defaultUnitsForLocale("en-US").temp).toBe("F");
    expect(defaultUnitsForLocale("de-DE").temp).toBe("C");
    expect(defaultUnitsForLocale(undefined).temp).toBe("C");
  });

  it("formats without negative zero", () => {
    const f = formatters(UNIT_PRESETS.metric);
    expect(f.temp(-0.2)).toBe("0°");
    expect(f.temp(null)).toBe("—");
    expect(f.pressureDelta(-1.26)).toBe("−1.3 hPa");
  });
});

describe("wmo", () => {
  it("maps codes to day/night icons", () => {
    expect(iconName(0, true)).toBe("clear-day");
    expect(iconName(0, false)).toBe("clear-night");
    expect(iconName(95, false)).toBe("scattered-thunderstorms-night");
    expect(iconName(1, true, { gustMs: 20 })).toBe("wind");
    expect(describeCode(65).scene).toBe("rain");
    expect(describeCode(1234).label).toBe("—");
  });
});
