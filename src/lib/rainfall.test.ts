import { describe, expect, it } from "vitest";
import type { AirQuality, Forecast, RecentPrecip } from "./api/open-meteo";
import { fireDays, hourFireLevel, smokeOutlook } from "./fire-weather";
import { dailyBars, rainTotals } from "./rainfall";

const H = 3600;
// UTC "local" days for simplicity: day 0 starts at T0.
const T0 = Date.UTC(2026, 9, 1) / 1000;

/** 34 days (31 past + today + 2) of hourly rain from `rain(hourIndex)`. */
function recent(rain: (h: number) => number): RecentPrecip {
  const hours = 34 * 24;
  const time = Array.from({ length: hours }, (_, i) => T0 + (i + 1) * H);
  const precip = time.map((_, i) => rain(i));
  const dTime = Array.from({ length: 34 }, (_, d) => T0 + d * 86_400);
  const dPrecip = dTime.map((_, d) => precip.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0));
  return { timezone: "UTC", fetchedAt: 0, hourly: { time, precip }, daily: { time: dTime, precip: dPrecip, snow: dTime.map(() => 0) } };
}

describe("rainTotals", () => {
  // "Now": noon on day 31 (Nov 1, so the month started today).
  const now = (T0 + 31 * 86_400 + 12 * H) * 1000;

  it("adds up the past and the forecast windows", () => {
    const r = recent(() => 0.5);
    const t = rainTotals(r, now);
    expect(t.lastHour).toBeCloseTo(0.5);
    expect(t.last24h).toBeCloseTo(12);
    expect(t.last7d).toBeCloseTo(84);
    expect(t.today).toBeCloseTo(6);
    expect(t.next24h).toBeCloseTo(12);
    expect(t.monthToDate).toBeCloseTo(6); // Nov 1: today only
    expect(t.dryDays).toBe(0);
  });

  it("counts dry days since the last wet day", () => {
    // Rain only during day 27.
    const r = recent((h) => (Math.floor(h / 24) === 27 ? 1 : 0));
    const t = rainTotals(r, now);
    expect(t.dryDays).toBe(3);
    expect(t.last24h).toBe(0);
    expect(t.monthToDate).toBe(0);
  });

  it("includes earlier days of the month", () => {
    const mid = (T0 + 10 * 86_400 + 12 * H) * 1000; // Oct 11, noon
    const t = rainTotals(recent(() => 0.25), mid);
    expect(t.monthToDate).toBeCloseTo(10 * 6 + 3);
  });

  it("builds daily bars around today", () => {
    const bars = dailyBars(recent(() => 0), now, 13, 3);
    expect(bars).toHaveLength(16);
    expect(bars.filter((b) => b.today)).toHaveLength(1);
    expect(bars.filter((b) => b.future)).toHaveLength(2);
  });
});

describe("fire weather", () => {
  const mph = 0.44704;
  it("rates an hour by humidity and wind together", () => {
    expect(hourFireLevel(50, 20 * mph, 40 * mph)).toBe(0);
    expect(hourFireLevel(22, 16 * mph, null)).toBe(1);
    expect(hourFireLevel(12, 22 * mph, 30 * mph)).toBe(2);
    expect(hourFireLevel(8, 10 * mph, 55 * mph)).toBe(3);
    expect(hourFireLevel(null, 30, 30)).toBe(0);
  });

  function forecast(rh: number, wind: number, precip = 0): Forecast {
    const time = Array.from({ length: 96 }, (_, i) => T0 + i * H);
    const fill = (v: number) => time.map(() => v);
    return {
      timezone: "UTC",
      daily: { time: [T0, T0 + 86_400, T0 + 2 * 86_400, T0 + 3 * 86_400] },
      hourly: { time, rh: fill(rh), wind10: fill(wind), gust10: fill(wind * 1.5), temp: fill(30), precip: fill(precip) },
    } as unknown as Forecast;
  }

  it("gives each day the level reached for two hours, softened by rain", () => {
    const now = (T0 + 6 * H) * 1000;
    expect(fireDays(forecast(12, 25 * mph), now).map((d) => d.level)).toEqual([2, 2, 2]);
    expect(fireDays(forecast(60, 25 * mph), now).map((d) => d.level)).toEqual([0, 0, 0]);
    expect(fireDays(forecast(12, 25 * mph, 0.5), now)[0]!.level).toBe(1);
    expect(fireDays(forecast(12, 25 * mph), now)[0]).toMatchObject({ minRh: 12, maxTemp: 30 });
  });

  it("describes smoke from PM2.5 and haze aloft from AOD", () => {
    const air = (pm: number[], aod: number) =>
      ({ timezone: "UTC", fetchedAt: 0, hourly: { time: pm.map((_, i) => T0 + i * H), pm25: pm, aod: pm.map(() => aod) } }) as unknown as AirQuality;
    const now = T0 * 1000;
    expect(smokeOutlook(air([5, 5, 5], 0.1), now).label).toBe("Clear air");
    expect(smokeOutlook(air([5, 5, 5], 0.8), now).label).toBe("Hazy sky");
    expect(smokeOutlook(air([40, 80, 20], 0.8), now)).toMatchObject({ label: "Smoky", now: 40, peak: 80, peakTime: (T0 + H) * 1000 });
    expect(smokeOutlook(air([200], 2), now).label).toBe("Heavy smoke");
  });
});
