import { describe, expect, it } from "vitest";
import { floodRank, parseGaugeList, parseReading, parseStages } from "./flood-gauges";
import { parseWildfires } from "./wildfires";

// Shapes as served by api.water.noaa.gov/nwps/v1 (sampled October 2026).
const OUT = { primary: -999, primaryUnit: "", secondary: -999, secondaryUnit: "", floodCategory: "out_of_service", validTime: "0001-01-01T00:00:00Z" };
const gauge = (lid: string, lat: number, lon: number, observed: object, forecast: object = OUT) => ({ lid, name: `${lid} river`, latitude: lat, longitude: lon, status: { observed, forecast } });

describe("NWPS gauges", () => {
  it("reads stage in feet from primary or secondary and skips dead gauges", () => {
    expect(parseReading({ primary: 10.93, primaryUnit: "ft", secondary: 13.4, secondaryUnit: "kcfs", floodCategory: "no_flooding", validTime: "2026-10-12T18:45:00Z" })).toEqual({
      value: 10.93,
      unit: "ft",
      category: "none",
      time: "2026-10-12T18:45:00Z",
    });
    expect(parseReading({ primary: 1.12, primaryUnit: "kcfs", secondary: 3.6, secondaryUnit: "ft", floodCategory: "minor", validTime: "2026-10-12T20:00:00Z" })).toMatchObject({ value: 3.6, unit: "ft", category: "minor" });
    expect(parseReading(OUT)).toBeNull();
    expect(parseReading({ ...OUT, floodCategory: "obs_not_current", primary: 4, primaryUnit: "ft", validTime: "2026-10-01T00:00:00Z" })).toBeNull();
    expect(parseReading({ primary: 4, primaryUnit: "ft", floodCategory: "not_defined", validTime: "2026-10-12T00:00:00Z" })?.category).toBe("none");
  });

  it("lists reporting gauges in range, flooding first, then nearest", () => {
    const ok = (c: string) => ({ primary: 5, primaryUnit: "ft", floodCategory: c, validTime: "2026-10-12T19:00:00Z" });
    const raw = {
      gauges: [
        gauge("NEAR1", 40.45, -80.0, ok("no_flooding")),
        gauge("FAR01", 40.8, -80.0, ok("no_flooding")),
        gauge("FLOOD", 40.7, -80.0, ok("moderate")),
        gauge("DEAD1", 40.44, -80.0, OUT),
        gauge("AWAY1", 42, -80.0, ok("major")),
      ],
    };
    const list = parseGaugeList(raw, { lat: 40.44, lon: -80 }, 60);
    expect(list.map((g) => g.lid)).toEqual(["FLOOD", "NEAR1", "FAR01"]);
    expect(list[1]!.distanceKm).toBeLessThan(2);
    expect(parseGaugeList({}, { lat: 0, lon: 0 }, 60)).toEqual([]);
  });

  it("reads the flood stage ladder", () => {
    const raw = { flood: { stageUnits: "ft", categories: { major: { stage: 23 }, moderate: { stage: 20 }, minor: { stage: 17 }, action: { stage: -9999 } } } };
    expect(parseStages(raw)).toEqual({ stages: { action: null, minor: 17, moderate: 20, major: 23 }, stageUnit: "ft" });
    expect(parseStages({})).toEqual({ stages: null, stageUnit: null });
  });

  it("ranks flood categories", () => {
    expect(floodRank("major")).toBeGreaterThan(floodRank("minor"));
    expect(floodRank(null)).toBe(0);
  });
});

describe("NIFC wildfires", () => {
  const f = (name: string, x: number, y: number, extra: object = {}) => ({
    attributes: { IncidentName: name, IncidentSize: 1200, PercentContained: 20, FireDiscoveryDateTime: 1784157600000, IncidentTypeCategory: "WF", FireCause: "Natural", ...extra },
    geometry: { x, y },
  });

  it("keeps uncontained wildfires in range, nearest first", () => {
    const raw = {
      features: [
        f("ROWE CREEK COMPLEX", -120.3, 44.8, { IncidentTypeCategory: "CX" }),
        f("Near Fire", -120.9, 44.5),
        f("Done", -120.9, 44.5, { PercentContained: 100 }),
        f("Burn", -120.9, 44.5, { IncidentTypeCategory: "RX" }),
        f("Far", -110, 44.5),
        f("Lac-368088", -120.95, 44.5, { IncidentSize: null }),
        f("Spot", -120.95, 44.5, { IncidentSize: null, FireDiscoveryDateTime: 1784157600000 + 3 * 86_400_000 }),
      ],
    };
    // Three days on: the old unsized report drops out, the fresh one stays.
    const list = parseWildfires(raw, { lat: 44.5, lon: -121 }, 250, 1784157600000 + 3 * 86_400_000 + 3_600_000);
    expect(list.map((w) => w.name)).toEqual(["Spot", "Near Fire", "Rowe Creek Complex"]);
    expect(list[2]).toMatchObject({ kind: "Complex", acres: 1200, contained: 20, cause: "Natural" });
    expect(list[1]!.discovered).toBe(new Date(1784157600000).toISOString());
    expect(parseWildfires({ error: { code: 400 } }, { lat: 0, lon: 0 }, 100)).toEqual([]);
  });
});
