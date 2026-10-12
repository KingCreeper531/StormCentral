import { describe, expect, it } from "vitest";
import type { Forecast } from "./api/open-meteo";
import { COMPARE_SOURCES, isCompareSourceId, modelUrl, precipBetween, seriesFromForecast } from "./compare-sources";

describe("compare sources", () => {
  it("lists unique ids with an Open-Meteo model for every remote source but Google", () => {
    expect(new Set(COMPARE_SOURCES.map((s) => s.id)).size).toBe(COMPARE_SOURCES.length);
    for (const s of COMPARE_SOURCES) expect(s.model == null).toBe(s.id === "app" || s.id === "google");
    expect(isCompareSourceId("ecmwf")).toBe(true);
    expect(isCompareSourceId("graphcast")).toBe(false);
    expect(modelUrl("ecmwf_ifs025", 40.44, -80)).toContain("models=ecmwf_ifs025");
  });

  it("turns the app's forecast into the comparison shape", () => {
    const t0 = Date.UTC(2026, 9, 12, 5) / 1000;
    const f = {
      timezone: "America/Chicago",
      utcOffsetSeconds: -5 * 3600,
      fetchedAt: 0,
      current: { temp: 20, feelsLike: 19, code: 1, isDay: 1, rh: 50, windSpeed: 3, windGust: 6, windDir: 180 },
      hourly: { time: [t0, t0 + 3600], temp: [15, null], code: [1, 2], isDay: [0, 0], precipProb: [10, 20], precip: [0, 1] },
      daily: { time: [t0 - 86_400, t0], tMax: [18, 22], tMin: [8, 12], code: [3, 61], precipProbMax: [5, 60], precipSum: [0, 4] },
    } as unknown as Forecast;
    const s = seriesFromForecast(f, Date.UTC(2026, 9, 12, 17));
    expect(s.hours).toHaveLength(1);
    expect(s.days).toEqual([{ date: "2026-10-12", hiC: 22, loC: 12, code: 61, text: null, precipChance: 60, precipMm: 4 }]);
    expect(s.current?.tempC).toBe(20);
    expect(precipBetween({ ...s, hours: [{ ...s.hours[0]!, precipMm: 2 }] }, t0 * 1000 - 1, t0 * 1000 + 1)).toBe(2);
    expect(precipBetween(s, 0, 1)).toBeNull();
  });
});
