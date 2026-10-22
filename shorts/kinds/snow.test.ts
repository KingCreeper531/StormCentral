import { describe, expect, it } from "vitest";
import type { StormReport } from "../../src/lib/feeds/storm-reports";
import { narration } from "../narration";
import { background } from "../script";
import { amount, isActive, snowDescription, snowEs, snowReports, snowTitle, summarize } from "./snow";

const report = (over: Partial<StormReport>): StormReport => ({
  id: Math.random().toString(36),
  time: "2025-01-21T18:00:00Z",
  kind: "snow",
  typeText: "SNOW",
  magnitude: 2,
  unit: "INCH",
  measured: null,
  place: "2 N PENSACOLA",
  county: null,
  state: "FL",
  source: null,
  remark: null,
  wfo: null,
  lat: 30.45,
  lon: -87.2,
  ...over,
});

// The Gulf Coast snow of January 21, 2025, cut down.
const RAW = [
  report({ place: "MILTON", magnitude: 7, time: "2025-01-21T20:00:00Z", lat: 30.63, lon: -87.04 }),
  report({ place: "MILTON", magnitude: 9.8, time: "2025-01-22T01:00:00Z", lat: 30.63, lon: -87.04 }), // its later, bigger total
  report({ place: "2 N MILTON", magnitude: 9, lat: 30.66, lon: -87.04 }), // another spot in the same town
  report({ place: "MOBILE", state: "AL", magnitude: 7.5, lat: 30.69, lon: -88.04 }),
  report({ place: "3 E RAYNE", state: "LA", typeText: "HEAVY SNOW", magnitude: 10.5, lat: 30.23, lon: -92.2 }),
  report({ place: "LAKE CHARLES", state: "LA", magnitude: 6, lat: 30.21, lon: -93.2 }),
  report({ place: "HOUSTON", state: "TX", magnitude: 1, lat: 29.76, lon: -95.37 }),
  report({ place: "BEAUMONT", state: "TX", magnitude: 3, lat: 30.08, lon: -94.1 }),
  report({ place: "DESTIN", magnitude: 4, lat: 30.39, lon: -86.5 }),
  report({ place: "SAVANNAH", state: "GA", magnitude: 0.5, lat: 32.08, lon: -81.09 }),
  report({ place: "NEW ORLEANS", state: "LA", magnitude: 8, lat: 29.95, lon: -90.07 }),
  report({ place: "BATON ROUGE", state: "LA", typeText: "SLEET", magnitude: 0.5, lat: 30.45, lon: -91.19 }), // not snow
  report({ place: "TALLAHASSEE", typeText: "FREEZING RAIN", magnitude: 0.1, lat: 30.44, lon: -84.28 }), // not snow
  report({ place: "GULFPORT", state: "MS", magnitude: 85, unit: "MPH", lat: 30.37, lon: -89.09 }), // not inches
  report({ place: "BILOXI", state: "MS", magnitude: 150, lat: 30.4, lon: -88.89 }), // a typo
  report({ kind: "hail", typeText: "HAIL", place: "TAMPA", magnitude: 1 }), // not winter
];
const reports = snowReports(RAW);
const s = summarize(reports);
const DAY = Date.parse("2025-01-22T14:50:00Z");

describe("snow totals", () => {
  it("keeps snowfall in inches, one per spot at its biggest, smallest first", () => {
    expect(reports.map((r) => [r.place, r.inches])).toEqual([
      ["Savannah, GA", 0.5],
      ["Houston, TX", 1],
      ["Beaumont, TX", 3],
      ["Destin, FL", 4],
      ["Lake Charles, LA", 6],
      ["Mobile, AL", 7.5],
      ["New Orleans, LA", 8],
      ["Milton, FL", 9],
      ["Milton, FL", 9.8],
      ["Rayne, LA", 10.5],
    ]);
  });

  it("counts the places and lists the biggest totals, one per town", () => {
    expect(s).toMatchObject({ total: 10, inch: 9, six: 6, foot: 0 });
    expect(s.top.map((r) => [r.place, r.inches])).toEqual([
      ["Rayne, LA", 10.5],
      ["Milton, FL", 9.8],
      ["New Orleans, LA", 8],
      ["Mobile, AL", 7.5],
      ["Lake Charles, LA", 6],
    ]);
    expect(s.states).toEqual(["LA", "FL", "TX"]);
  });

  it("posts only after a real snow: 6 inches somewhere and 8 places with an inch", () => {
    expect(isActive(s)).toBe(true);
    expect(isActive(summarize(reports.slice(0, 9)))).toBe(true);
    expect(isActive(summarize(reports.filter((r) => r.inches < 6)))).toBe(false);
    expect(isActive(summarize(reports.slice(3)))).toBe(false); // 7 places with an inch
    expect(isActive(summarize([]))).toBe(false);
  });

  it("writes the title and description from the reports", () => {
    expect(snowTitle(s, DAY)).toBe("Snow Totals, Wed, Jan 22: Up to 10.5 in near Rayne, LA #shorts");
    const d = snowDescription(s);
    expect(d).toContain("9 places reported an inch or more, most of them in Louisiana, Florida and Texas, and 6 reported 6 inches or more.");
    expect(d).toContain("1. 10.5 in near Rayne, LA\n2. 9.8 in near Milton, FL");
    expect(d).toContain("Iowa Environmental Mesonet");
    const es = snowEs(s, DAY);
    expect(es.title).toMatch(/^Nieve acumulada, mié,? 22 de ene\.?: hasta 10\.5 in \(27 cm\) #shorts$/);
    expect(es.description).toContain("10.5 in (27 cm) cerca de Rayne, LA");
    for (const t of [snowTitle(s, DAY), es.title]) expect(t.length).toBeLessThanOrEqual(100);
    expect(amount(0.25)).toBe("0.3");
    expect(amount(12)).toBe("12");
  });

  it("narrates the counts, the states and the biggest totals", () => {
    const data = {
      date: "Wednesday, January 22",
      counts: { total: s.total, inch: s.inch, six: s.six, foot: s.foot },
      top: s.top.map((r) => ({ value: `${amount(r.inches)} in`, inches: r.inches, place: r.place })),
      topStates: ["Louisiana", "Florida", "Texas"],
    };
    expect(narration({ template: "snow.html", data }).map((c) => c.text)).toEqual([
      "Here are the snow totals from the past 24 hours.",
      "9 places reported an inch or more, and 6 of them 6 inches or more.",
      "Most of the snow fell in Louisiana, Florida and Texas.",
      "The biggest total: 10.5 inches, near Rayne, Louisiana.",
      "Then 9.8 inches near Milton, Florida and 8 inches near New Orleans, Louisiana.",
    ]);
    expect(background({ template: "snow.html", data })).toContain(
      "The biggest totals: 10.5 inches near Rayne, Louisiana; 9.8 inches near Milton, Florida; 8 inches near New Orleans, Louisiana; 7.5 inches near Mobile, Alabama; 6 inches near Lake Charles, Louisiana.",
    );
  });
});
