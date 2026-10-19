import { describe, expect, it } from "vitest";
import type { StormReport } from "./feeds/storm-reports";
import { matchNwsReports, nwsRef, parseNwsRef } from "./nws-match";

const T0 = Date.parse("2026-05-20T23:00:00Z");
const lsr = (over: Partial<StormReport>): StormReport => ({
  id: "r1",
  time: new Date(T0 - 10 * 60_000).toISOString(),
  kind: "hail",
  typeText: "HAIL",
  magnitude: 1.75,
  unit: "INCH",
  measured: false,
  place: "3 N ENID",
  county: "Garfield",
  state: "OK",
  source: "TRAINED SPOTTER",
  remark: null,
  wfo: "OUN",
  lat: 36.44,
  lon: -97.88,
  ...over,
});
const post = { id: "p1", category: "hail", lat: 36.4, lon: -97.9, createdAt: T0 };

describe("matchNwsReports", () => {
  it("confirms a report with an NWS report of the same kind, nearby, around the same time", () => {
    expect(matchNwsReports([post], [lsr({})]).get("p1")?.id).toBe("r1");
  });

  it("needs the same kind, 15 km and the time window", () => {
    expect(matchNwsReports([post], [lsr({ kind: "wind" })]).size).toBe(0);
    expect(matchNwsReports([post], [lsr({ lat: 36.6 })]).size).toBe(0); // ~22 km away
    expect(matchNwsReports([post], [lsr({ time: new Date(T0 - 2 * 3_600_000).toISOString() })]).size).toBe(0);
    expect(matchNwsReports([post], [lsr({ time: new Date(T0 + 45 * 60_000).toISOString() })]).size).toBe(0);
    expect(matchNwsReports([{ ...post, category: "lightning" }], [lsr({})]).size).toBe(0);
  });

  it("lets a funnel cloud confirm a tornado report and takes the nearest match", () => {
    const tornado = { ...post, category: "tornado" };
    const m = matchNwsReports([tornado], [lsr({ id: "far", kind: "tornado", lat: 36.5 }), lsr({ id: "near", kind: "funnel", lat: 36.41 })]);
    expect(m.get("p1")?.id).toBe("near");
  });
});

describe("parseNwsRef", () => {
  it("round-trips what a post keeps and rejects junk", () => {
    const ref = nwsRef(lsr({}));
    expect(parseNwsRef(JSON.stringify(ref))).toEqual(ref);
    expect(parseNwsRef("{")).toBeNull();
    expect(parseNwsRef(JSON.stringify({ id: 1 }))).toBeNull();
    expect(parseNwsRef(null)).toBeNull();
  });
});
