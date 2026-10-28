import { describe, expect, it } from "vitest";
import { mercatorY } from "../geo";
import { bilinear, gridPoints, hourIndex, MAX_POINTS, MODEL_HOURS, modelGridUrl, parseModelGrid, planGrid, planServes, windComponents, WindSampler, type GridPlan } from "./grid";

const OKLAHOMA = { west: -100, south: 33, east: -95, north: 37 };
const CONUS = { west: -125, south: 24, east: -66, north: 50 };

describe("model grid plan", () => {
  it("samples a regional view every degree or less, edges snapped to whole degrees", () => {
    const p = planGrid(OKLAHOMA);
    expect(p.step).toBeLessThanOrEqual(0.75);
    for (const v of Object.values(p.bbox)) expect(Number.isInteger(v)).toBe(true);
    expect(p.bbox.west).toBeLessThanOrEqual(OKLAHOMA.west);
    expect(p.bbox.north).toBeGreaterThanOrEqual(OKLAHOMA.north);
    expect(p.cols * p.rows).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("goes coarser for wide views but never past the point cap", () => {
    for (const view of [CONUS, { west: -540, south: -90, east: 540, north: 90 }, { west: 10, south: 50, east: 10.2, north: 50.1 }]) {
      const p = planGrid(view);
      expect(p.cols).toBeGreaterThanOrEqual(2);
      expect(p.rows).toBeGreaterThanOrEqual(2);
      expect(p.cols * p.rows).toBeLessThanOrEqual(MAX_POINTS);
      expect(p.bbox.west).toBeGreaterThanOrEqual(-180);
      expect(p.bbox.north).toBeLessThanOrEqual(80);
    }
    expect(planGrid(CONUS).step).toBeGreaterThan(planGrid(OKLAHOMA).step);
  });

  it("keeps the grid for small pans and refetches when zoomed in for detail", () => {
    const p = planGrid(CONUS);
    expect(planServes(p, { west: -123, south: 25, east: -64, north: 49 })).toBe(true);
    expect(planServes(p, OKLAHOMA)).toBe(false);
    expect(planServes(p, { west: -140, south: 24, east: -81, north: 50 })).toBe(false);
    // A fresh plan always serves its own view (the map hook relies on it to settle).
    for (const v of [CONUS, OKLAHOMA, { west: -200, south: -89, east: 250, north: 89 }, { west: 179, south: 0, east: 181, north: 1 }, { west: -190, south: 0, east: -185, north: 1 }])
      expect(planServes(planGrid(v), v)).toBe(true);
  });

  it("asks Open-Meteo for every point and variable in one request", () => {
    const p = planGrid(OKLAHOMA);
    const { lats, lons } = gridPoints(p);
    expect(lats).toHaveLength(p.cols * p.rows);
    // North-west first, rows evenly spaced in Mercator Y.
    expect(lats[0]).toBeGreaterThan(lats[lats.length - 1]!);
    expect(lons[0]).toBeLessThan(lons[p.cols - 1]!);
    const url = decodeURIComponent(modelGridUrl(p));
    expect(url).toContain(`latitude=${lats.join(",")}`);
    expect(url).toContain("hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,cape,precipitation,snowfall");
    expect(url).toContain(`forecast_hours=${MODEL_HOURS + 1}`);
    expect(url).toContain("wind_speed_unit=ms");
  });
});

const PLAN: GridPlan = { bbox: { west: 0, east: 2, south: 0, north: 2 }, cols: 2, rows: 2, step: 1 };
const point = (speed: number, dir: number, temp: number | null) => ({
  hourly: { time: [3600, 7200], wind_speed_10m: [speed, speed], wind_direction_10m: [dir, dir], temperature_2m: [temp, 1], precipitation: [0, 0] },
});

describe("model grid response", () => {
  it("parses a multi-location response into per-hour grids", () => {
    const g = parseModelGrid([point(5, 270, 10), point(5, 270, 12), point(5, 270, null), point(5, 270, 16)], PLAN);
    expect(g.times).toEqual([3_600_000, 7_200_000]);
    expect([...g.values.temperature_2m[0]!]).toEqual([10, 12, Number.NaN, 16]);
    expect(g.values.temperature_2m[1]![2]).toBe(1);
    // Variables the response lacks are missing, not zero.
    expect(Number.isNaN(g.values.snowfall[0]![0]!)).toBe(true);
  });

  it("accepts a single-location object", () => {
    expect(parseModelGrid(point(1, 0, 3), { ...PLAN, cols: 2, rows: 1 }).values.temperature_2m[0]![0]).toBe(3);
  });

  it("picks the hour at or before a time", () => {
    const times = [1000, 2000, 3000];
    expect(hourIndex(times, 500)).toBe(0);
    expect(hourIndex(times, 2000)).toBe(1);
    expect(hourIndex(times, 2999)).toBe(1);
    expect(hourIndex(times, 9999)).toBe(2);
    expect(hourIndex([], 9999)).toBe(0);
  });
});

describe("interpolation", () => {
  const v = Float32Array.from([0, 10, 20, 30]); // 2×2: NW, NE, SW, SE

  it("is bilinear between samples and clamped at the edges", () => {
    expect(bilinear(v, 2, 2, 0, 0)).toBe(0);
    expect(bilinear(v, 2, 2, 1, 1)).toBe(30);
    expect(bilinear(v, 2, 2, 0.5, 0)).toBe(5);
    expect(bilinear(v, 2, 2, 0.5, 0.5)).toBe(15);
    expect(bilinear(v, 2, 2, -3, 9)).toBe(20);
  });

  it("leaves missing samples out", () => {
    const gap = Float32Array.from([0, Number.NaN, 20, 30]);
    expect(bilinear(gap, 2, 2, 0.5, 0)).toBe(0);
    // Exactly on the missing sample: the one below it.
    expect(bilinear(gap, 2, 2, 1, 0)).toBe(30);
    expect(Number.isNaN(bilinear(new Float32Array(4).fill(Number.NaN), 2, 2, 0.5, 0.5))).toBe(true);
  });

  it("turns the direction the wind blows from into components", () => {
    const [u, v] = windComponents(10, 270); // a westerly blows toward the east
    expect(u).toBeCloseTo(10);
    expect(v).toBeCloseTo(0);
    const [u2, v2] = windComponents(10, 0); // a northerly blows south
    expect(u2).toBeCloseTo(0);
    expect(v2).toBeCloseTo(-10);
  });

  it("samples the wind by longitude and Mercator Y, and nothing outside the grid", () => {
    const north = [point(10, 0, 0), point(10, 0, 0)];
    const south = [point(10, 90, 0), point(10, 90, 0)];
    const s = new WindSampler(parseModelGrid([...north, ...south], PLAN), 0);
    const out = new Float64Array(2);
    expect(s.sample(1, mercatorY(1), out)).toBe(true);
    // Halfway between a northerly (0, -10) and an easterly (-10, 0).
    expect(out[0]).toBeCloseTo(-5);
    expect(out[1]).toBeCloseTo(-5);
    expect(s.sample(3, mercatorY(1), out)).toBe(false);
    expect(s.sample(1, mercatorY(-1), out)).toBe(false);
  });
});
