import { afterEach, describe, expect, it } from "vitest";
import type { Forecast } from "../api/open-meteo";
import { setTimePrefs } from "../clock";
import { clockIn, dailyTempRange, dayFmtIn, todayIndex } from "./view";

afterEach(() => setTimePrefs({ zone: "auto" }));

/** A forecast with only daily rows (epoch s of the place's local midnights). */
const days = (time: number[], tMin: (number | null)[] = [], tMax: (number | null)[] = []) => ({ daily: { time, tMin, tMax } }) as unknown as Forecast;
const s = (iso: string) => Date.parse(iso) / 1000;

const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
const at = Date.parse("2026-10-07T19:37:00Z");
const plain = (tz: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(at);
// A zone whose clock never matches the device's (offsets differ by 5:45 or 5:30).
const elsewhere = plain("Asia/Kathmandu") === plain(device) ? "Asia/Kolkata" : "Asia/Kathmandu";

describe("clockIn", () => {
  it("formats in the given zone and omits the zone when the device clock agrees", () => {
    expect(clockIn(device, at)).toBe(plain(device));
    expect(clockIn(undefined, at)).toBe(plain(device));
  });

  it("names the zone when the location's clock differs from the device's", () => {
    const s = clockIn(elsewhere, at);
    expect(s.startsWith(plain(elsewhere))).toBe(true);
    expect(s.length).toBeGreaterThan(plain(elsewhere).length);
  });

  it("accepts ISO strings and Dates, and survives an unknown zone", () => {
    expect(clockIn(elsewhere, new Date(at).toISOString())).toBe(clockIn(elsewhere, new Date(at)));
    expect(clockIn("Not/AZone", at)).toBe(plain(device));
  });
});

describe("todayIndex", () => {
  it("ends each day where the next starts, across DST changes", () => {
    // Chicago: Nov 1 2026 is 25 hours long (CDT → CST).
    const fall = days([s("2026-10-31T05:00Z"), s("2026-11-01T05:00Z"), s("2026-11-02T06:00Z"), s("2026-11-03T06:00Z")]);
    expect(todayIndex(fall, Date.parse("2026-11-02T05:30Z"))).toBe(1); // 11:30 PM CST on Nov 1
    expect(todayIndex(fall, Date.parse("2026-11-02T06:30Z"))).toBe(2);
    // Mar 14 2027 is 23 hours long (CST → CDT).
    const spring = days([s("2027-03-13T06:00Z"), s("2027-03-14T06:00Z"), s("2027-03-15T05:00Z")]);
    expect(todayIndex(spring, Date.parse("2027-03-15T05:30Z"))).toBe(2); // 12:30 AM CDT on Mar 15
    expect(todayIndex(spring, Date.parse("2027-03-15T04:30Z"))).toBe(1);
    // The last day still lasts 24 hours.
    expect(todayIndex(spring, Date.parse("2027-03-15T20:00Z"))).toBe(2);
  });
});

describe("dailyTempRange", () => {
  it("leaves out days without values", () => {
    const f = days([0, 1, 2, 3], [5, 3, null, null], [12, 15, null, null]);
    expect(dailyTempRange(f, [0, 1, 2, 3])).toEqual({ min: 3, max: 15 });
    expect(dailyTempRange(f, [2, 3])).toBeNull();
    // Below freezing all week: a missing day doesn't count as 0°.
    expect(dailyTempRange(days([0, 1], [-12, null], [-4, null]), [0, 1])).toEqual({ min: -12, max: -4 });
  });
});

describe("dayFmtIn", () => {
  // Tokyo's Thursday, Oct 22 2026, starts at 15:00 UTC on Wednesday.
  const thursday = Date.parse("2026-10-21T15:00:00Z");

  it("names the place's day even with the device's time zone chosen", () => {
    setTimePrefs({ zone: "device" });
    expect(dayFmtIn("Asia/Tokyo", { weekday: "short" }, "en-US").format(thursday)).toBe("Thu");
    expect(dayFmtIn("Asia/Tokyo", { month: "short", day: "numeric" }, "en-US").format(thursday)).toBe("Oct 22");
  });

  it("survives an unknown zone", () => {
    expect(dayFmtIn("Not/AZone", { weekday: "short" }, "en-US").format(thursday)).toBe(new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(thursday));
  });
});
