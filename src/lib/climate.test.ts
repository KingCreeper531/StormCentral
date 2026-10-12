import { describe, expect, it } from "vitest";
import { buildClimate, climateSlot, isoDateIn, normalPrecipOver, normalPrecipToDate, rankStations, slotOf, type AcisStation } from "./climate";

// Shapes as served by data.rcc-acis.org (sampled October 2026).
const NOW = Date.UTC(2026, 9, 12);
const meta = {
  meta: [
    { valid_daterange: [["1921-07-01", "2000-03-27"]], ll: [-80.23333, 40.18333], sids: ["369312 2", "USC00369312 6", "WSHP1 7"], name: "WASHINGTON" },
    { valid_daterange: [["2008-02-05", "2026-10-12"]], ll: [-80.20578, 40.54886], sids: ["363343 2", "USC00363343 6", "GWDP1 7"], name: "GLENWILLARD DASHIELDS LOCK AND DAM" },
    { valid_daterange: [["1948-01-01", "2026-10-11"]], ll: [-80.21448, 40.48459], sids: ["94823 1", "366993 2", "PIT 3", "72520 4", "KPIT 5", "USW00094823 6", "PIT 7"], name: "PITTSBURGH INTERNATIONAL AIRPORT" },
    { valid_daterange: [["1977-12-01", "2026-10-09"]], ll: [-79.8594, 40.3916], sids: ["360861 2", "USC00360861 6", "BDDP1 7"], name: "BRADDOCK LOCK 2" },
  ],
};

const station: AcisStation = { name: "PITTSBURGH INTERNATIONAL AIRPORT", sid: "94823", faa: "PIT", lat: 40.48, lon: -80.21, distanceKm: 18.5, start: "1948-01-01", end: "2026-10-11" };

function leapYear<T>(f: (iso: string, i: number) => T): T[] {
  const out: T[] = [];
  for (let t = Date.UTC(2024, 0, 1), i = 0; t <= Date.UTC(2024, 11, 31); t += 86_400_000, i++) out.push(f(new Date(t).toISOString().slice(0, 10), i));
  return out;
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

describe("rankStations", () => {
  it("keeps current long-record stations, preferring a nearby airport", () => {
    const r = rankStations(meta, { lat: 40.44, lon: -80.0 }, NOW);
    // Washington ended in 2000; Glenwillard has under 30 years.
    expect(r.map((s) => s.name)).toEqual(["PITTSBURGH INTERNATIONAL AIRPORT", "BRADDOCK LOCK 2"]);
    expect(r[0]).toMatchObject({ faa: "PIT", sid: "94823", start: "1948-01-01" });
    expect(r[1]!.faa).toBeNull();
    expect(r[1]!.sid).toBe("360861");
    expect(rankStations({ meta: [] }, { lat: 0, lon: 0 }, NOW)).toEqual([]);
  });
});

describe("buildClimate", () => {
  const records = {
    meta: { name: "Pittsburgh Area", valid_daterange: [["1875-01-01", "2026-10-11"]] },
    smry: [
      leapYear((iso) => [iso === "2024-10-12" ? "85" : "70", iso === "2024-10-12" ? "1879-10-12" : "1990-" + iso.slice(5)]),
      leapYear((iso) => [iso === "2024-10-12" ? "23" : "M", "1988-" + iso.slice(5)]),
      leapYear(() => ["T", "2001-01-01"]),
    ],
  };
  const normals = { data: leapYear((iso) => [iso, "65", "45", "0.09"]) };

  it("converts records and normals to °C and mm by calendar slot", () => {
    const c = buildClimate(records, normals, station, records.meta.name, records.meta.valid_daterange[0] as [string, string]);
    const s = slotOf("2026-10-12");
    expect(c.station).toBe("Pittsburgh Area");
    expect(c.recordYears).toEqual([1875, 2026]);
    expect(c.normalYears).toEqual([1991, 2020]);
    expect(c.recHi[s]).toBe(29.4);
    expect(c.recHiYear[s]).toBe(1879);
    expect(c.recLo[s]).toBe(-5);
    expect(c.recLo[s + 1]).toBeNull(); // "M"
    expect(c.recPrecip[0]).toBe(0); // trace
    expect(c.hi[s]).toBe(18.3);
    expect(c.lo[s]).toBe(7.2);
    expect(c.precip[s]).toBe(2.29);
    expect(c.hi).toHaveLength(366);
  });

  it("falls back to the station's own name and record", () => {
    const c = buildClimate({}, {}, station);
    expect(c.station).toBe("Pittsburgh International Airport");
    expect(c.recordYears).toEqual([1948, 2026]);
    expect(c.hi.every((v) => v == null)).toBe(true);
    expect(normalPrecipToDate(c, "2026-01-01")).toBeNull();
  });

  it("sums normal precipitation for the month to date and over a window", () => {
    const c = buildClimate({}, { data: leapYear((iso) => [iso, "50", "30", "0.10"]) }, station);
    const day = 2.54;
    expect(normalPrecipToDate(c, "2026-02-10")?.toDate).toBeCloseTo(10 * day);
    expect(normalPrecipToDate(c, "2026-02-10")?.month).toBeCloseTo(28 * day);
    expect(normalPrecipToDate(c, "2028-02-29")?.month).toBeCloseTo(29 * day);
    expect(normalPrecipOver(c, "2026-10-12", 30)).toBeCloseTo(30 * day);
  });
});

describe("isoDateIn", () => {
  it("formats the local date in a zone", () => {
    const t = Date.UTC(2026, 9, 13, 2); // 10 pm on the 12th in New York
    expect(isoDateIn(t, "America/New_York")).toBe("2026-10-12");
    expect(isoDateIn(t, "UTC")).toBe("2026-10-13");
  });
});
