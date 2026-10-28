import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWaveGrid, parseWaveGrid, waveGridPoints, waveHour, WAVE_HOURS } from "./api/open-meteo-marine";
import { mercatorY } from "./geo";
import { formatWaveHeight, WAVE_GRADIENT, WAVE_LEGEND_M, WAVE_STOPS, waveRgb, waveStopAt, waveTick } from "./marine";

describe("wave height scale", () => {
  it("hits each stop's colour and blends between them", () => {
    expect(waveRgb(0)).toEqual([0x2b, 0x5c, 0x8a]);
    expect(waveRgb(2)).toEqual([0xd6, 0xd2, 0x3a]);
    expect(waveRgb(2.5)).toEqual([Math.round((0xd6 + 0xf2) / 2), Math.round((0xd2 + 0x9b) / 2), Math.round((0x3a + 0x30) / 2)]);
    // Below and beyond the scale clamp to its ends.
    expect(waveRgb(-1)).toEqual(waveRgb(0));
    expect(waveRgb(Number.NaN)).toEqual(waveRgb(0));
    expect(waveRgb(15)).toEqual([0x6a, 0x1b, 0x9a]);
  });

  it("labels every legend height at a stop of the bar", () => {
    for (const m of WAVE_LEGEND_M) expect(WAVE_STOPS.some(([s]) => s === m)).toBe(true);
    expect(waveStopAt(0)).toBe(0);
    expect(waveStopAt(9)).toBe(1);
    expect(WAVE_GRADIENT).toMatch(/^linear-gradient\(to right, #2b5c8a 0\.0%, .* #6a1b9a 100\.0%\)$/);
  });

  it("formats heights in the person's unit, with a decimal", () => {
    expect(formatWaveHeight(1.6, "m")).toBe("1.6 m");
    expect(formatWaveHeight(1.6, "ft")).toBe("5.2 ft");
    expect(formatWaveHeight(null, "ft")).toBe("—");
    expect(waveTick(3, "ft")).toBe("10");
    expect(waveTick(3, "m")).toBe("3");
  });
});

describe("wave forecast grid", () => {
  const view = { west: -80, south: 25, east: -60, north: 45 };

  it("samples cell centres evenly in Mercator, north-west first", () => {
    const { bbox, lats, lons } = waveGridPoints(view, 4, 3);
    expect(bbox).toEqual(view);
    expect(lats).toHaveLength(12);
    expect(lons.slice(0, 4)).toEqual([-77.5, -72.5, -67.5, -62.5]);
    // Rows are evenly spaced in Mercator Y, not in degrees.
    const ys = [lats[0]!, lats[4]!, lats[8]!].map(mercatorY);
    expect(ys[0]! - ys[1]!).toBeCloseTo(ys[1]! - ys[2]!, 3);
    expect(lats[0]).toBeGreaterThan(lats[8]!);
  });

  it("clamps a view past the antimeridian or the poles", () => {
    expect(waveGridPoints({ west: -200, south: -89, east: 200, north: 89 }, 2, 2).bbox).toEqual({ west: -180, south: -80, east: 180, north: 84 });
  });

  // Shaped like Open-Meteo's multi-location response: one object per point, hourly from midnight GMT.
  const T0 = Date.UTC(2026, 9, 28) / 1000;
  const hours = 72;
  const time = Array.from({ length: hours }, (_, h) => T0 + h * 3600);
  const sea = (base: number) => ({
    latitude: 35,
    longitude: -70,
    hourly_units: { time: "unixtime", wave_height: "m", wave_direction: "°", wave_period: "s" },
    hourly: {
      time,
      wave_height: time.map((_, h) => +(base + h / 100).toFixed(2)),
      wave_direction: time.map(() => 135),
      wave_period: time.map(() => 8.5),
    },
  });
  const land = { latitude: 40, longitude: -78, hourly: { time, wave_height: time.map(() => null), wave_direction: time.map(() => null), wave_period: time.map(() => null) } };

  it("starts at the current hour, keeps 48 hours and leaves land empty", () => {
    const points = waveGridPoints(view, 2, 1);
    const now = Date.UTC(2026, 9, 28, 14, 25);
    const grid = parseWaveGrid([land, sea(1)], points, 2, 1, now);
    expect(grid.times).toHaveLength(WAVE_HOURS);
    expect(grid.times[0]).toBe(Date.UTC(2026, 9, 28, 14));
    const first = waveHour(grid, 0);
    expect(Number.isNaN(first.height[0]!)).toBe(true);
    expect(Number.isNaN(first.direction[0]!)).toBe(true);
    expect(first.height[1]).toBeCloseTo(1.14);
    expect(first.direction[1]).toBe(135);
    expect(first.period[1]).toBe(8.5);
    expect(waveHour(grid, 47).height[1]).toBeCloseTo(1.61);
    // Out of range hours clamp to the ends.
    expect(waveHour(grid, 99).height[1]).toBeCloseTo(1.61);
  });

  it("reads a single-location response and an empty one", () => {
    const points = waveGridPoints(view, 1, 1);
    expect(parseWaveGrid(sea(2), points, 1, 1, T0 * 1000).height[0]).toBe(2);
    const empty = parseWaveGrid({}, points, 1, 1, T0 * 1000);
    expect(empty.times).toEqual([]);
    expect(waveHour(empty, 0).height).toHaveLength(0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("asks for the three wave variables at every grid point in one request", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify([sea(1), sea(2), land, sea(3)])));
    vi.stubGlobal("fetch", fetch);
    const grid = await fetchWaveGrid(view, 2, 2);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe("https://marine-api.open-meteo.com/v1/marine");
    expect(url.searchParams.get("hourly")).toBe("wave_height,wave_direction,wave_period");
    expect(url.searchParams.get("latitude")!.split(",")).toHaveLength(4);
    expect(url.searchParams.get("longitude")).toBe("-75,-65,-75,-65");
    expect(grid.cols * grid.rows).toBe(4);
  });
});
