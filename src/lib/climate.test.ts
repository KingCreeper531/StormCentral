import { describe, expect, it } from "vitest";
import { buildClimate, climateSlot, isoDateIn, normalPrecipOver, normalPrecipToDate, slotOf } from "./climate";

/** Daily archive for `years`, with values from `f(year, month, day)`. */
function archive(years: [number, number], f: (y: number, m: number, d: number) => [number, number, number]) {
  const time: string[] = [];
  const tx: number[] = [];
  const tn: number[] = [];
  const pr: number[] = [];
  for (let t = Date.UTC(years[0], 0, 1); t <= Date.UTC(years[1], 11, 31); t += 86_400_000) {
    const d = new Date(t);
    const [h, l, p] = f(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    time.push(d.toISOString().slice(0, 10));
    tx.push(h);
    tn.push(l);
    pr.push(p);
  }
  return { latitude: 40.5, longitude: -80, daily: { time, temperature_2m_max: tx, temperature_2m_min: tn, precipitation_sum: pr } };
}

describe("climateSlot", () => {
  it("maps every calendar date to a fixed slot", () => {
    expect(climateSlot(1, 1)).toBe(0);
    expect(climateSlot(2, 29)).toBe(59);
    expect(climateSlot(3, 1)).toBe(60);
    expect(climateSlot(12, 31)).toBe(365);
    expect(slotOf("2026-10-12")).toBe(285);
  });
});

describe("buildClimate", () => {
  it("averages 1991–2020 for normals and finds records over every year", () => {
    // Constant 20/10 °C and 2 mm a day, except one hot day and one cold day.
    const c = buildClimate(
      archive([1951, 2025], (y, m, d) => {
        if (y === 1988 && m === 7 && d === 4) return [40, 25, 0];
        if (y === 2024 && m === 1 && d === 15) return [-5, -30, 50];
        return [20, 10, 2];
      }),
    );
    expect(c.recordYears).toEqual([1951, 2025]);
    expect(c.normalYears).toEqual([1991, 2020]);
    expect(c.hi[slotOf("2026-07-04")]).toBe(20); // 1988 is outside the normals period
    expect(c.recHi[slotOf("2026-07-04")]).toBe(40);
    expect(c.recHiYear[slotOf("2026-07-04")]).toBe(1988);
    expect(c.recLo[slotOf("2026-01-15")]).toBe(-30);
    expect(c.recLoYear[slotOf("2026-01-15")]).toBe(2024);
    expect(c.recPrecip[slotOf("2026-01-15")]).toBe(50);
    // Ties go to the most recent year.
    expect(c.recHiYear[slotOf("2026-03-10")]).toBe(2025);
    expect(c.precip[0]).toBe(2);
    expect(c.hi).toHaveLength(366);
  });

  it("smooths normals over neighbouring days", () => {
    // Highs rise 1 °C per day of year: the smoothed normal still matches mid-year.
    const c = buildClimate(archive([1991, 2020], (_y, m, d) => [climateSlot(m, d) / 10, 0, 0]));
    expect(c.hi[slotOf("2026-06-15")]).toBeCloseTo(climateSlot(6, 15) / 10, 1);
  });

  it("sums normal rainfall for the month to date and over a window", () => {
    const c = buildClimate(archive([1991, 2020], () => [10, 0, 3]));
    expect(normalPrecipToDate(c, "2026-02-10")).toEqual({ toDate: 30, month: 84 });
    expect(normalPrecipToDate(c, "2028-02-29")?.month).toBeCloseTo(87);
    expect(normalPrecipOver(c, "2026-10-12", 30)).toBeCloseTo(90);
  });

  it("handles an empty response", () => {
    const c = buildClimate({});
    expect(c.hi.every((v) => v == null)).toBe(true);
    expect(normalPrecipToDate(c, "2026-01-01")).toBeNull();
  });
});

describe("isoDateIn", () => {
  it("formats the local date in a zone", () => {
    const t = Date.UTC(2026, 9, 13, 2); // 10 pm on the 12th in New York
    expect(isoDateIn(t, "America/New_York")).toBe("2026-10-12");
    expect(isoDateIn(t, "UTC")).toBe("2026-10-13");
  });
});
