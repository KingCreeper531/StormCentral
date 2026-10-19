import { describe, expect, it } from "vitest";
import { haversineKm } from "../geo";
import { closeRing, edgeMidpoints, insertVertex, latLonLine, moveVertex, openRing, removeVertex, ringAreaKm2, selfIntersects, trackPolygon, type Ring } from "./geometry";
import { draftProblems, issueSchema } from "./schema";
import { productName, UNOFFICIAL_BANNER, warningText, type WarningTextInput } from "./text";

const NORMAN = { lat: 35.22, lon: -97.44 };

describe("WarnGen polygon", () => {
  it("draws a box from the storm widening down its track", () => {
    const ring = trackPolygon(NORMAN, { headingDeg: 45, speedKt: 30 }, 30);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(selfIntersects(ring)).toBe(false);
    const [bl, fl, fr, br] = openRing(ring);
    // Wider at the far end than at the storm.
    expect(haversineKm({ lon: fl![0], lat: fl![1] }, { lon: fr![0], lat: fr![1] })).toBeGreaterThan(haversineKm({ lon: bl![0], lat: bl![1] }, { lon: br![0], lat: br![1] }));
    // 30 kt for 30 min is ~28 km, plus the buffers: a storm-scale area.
    const area = ringAreaKm2(ring);
    expect(area).toBeGreaterThan(300);
    expect(area).toBeLessThan(1500);
  });

  it("draws an octagon around a stationary storm", () => {
    const ring = trackPolygon(NORMAN, null, 120);
    expect(openRing(ring)).toHaveLength(8);
    expect(ringAreaKm2(ring)).toBeGreaterThan(300);
  });

  it("edits corners and keeps the ring closed", () => {
    const ring = closeRing([
      [-97.5, 35.1],
      [-97.2, 35.1],
      [-97.2, 35.4],
      [-97.5, 35.4],
    ]);
    expect(edgeMidpoints(ring)[0]).toEqual([-97.35, 35.1]);
    const added = insertVertex(ring, 0, [-97.35, 35.0]);
    expect(openRing(added)).toHaveLength(5);
    const moved = moveVertex(added, 1, [-97.354, 34.951]);
    expect(moved[1]).toEqual([-97.35, 34.95]);
    expect(moved[0]).toEqual(moved.at(-1));
    expect(openRing(removeVertex(moved, 1))).toHaveLength(4);
    // Never below a triangle.
    expect(openRing(removeVertex(removeVertex(ring, 0), 0))).toHaveLength(3);
  });

  it("finds bow-tie polygons", () => {
    const bow: Ring = closeRing([
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    expect(selfIntersects(bow)).toBe(true);
  });

  it("writes the LAT...LON line like the NWS", () => {
    const ring = closeRing([
      [-97.5, 35.1],
      [-97.2, 35.1],
      [-97.2, 35.4],
    ]);
    expect(latLonLine(ring)).toBe("LAT...LON 3510 9750 3510 9720 3540 9720");
  });
});

describe("WarnGen validation", () => {
  const polygon = trackPolygon(NORMAN, { headingDeg: 45, speedKt: 30 }, 30);
  const base = { polygon, minutes: 45, storm: { ...NORMAN, t: 1 }, motion: { headingDeg: 45, speedKt: 30 }, basis: "radar", hail: 1, wind: 60, tornadoPossible: false, threat: "base", notes: null, place: "Norman, OK", locations: ["Norman", "Moore"] };

  it("accepts a valid severe thunderstorm warning", () => {
    expect(issueSchema.safeParse({ kind: "SVR", ...base }).success).toBe(true);
  });

  it("holds products to their criteria", () => {
    expect(draftProblems({ kind: "SVR", polygon, minutes: 45, hail: 0.75, wind: 50, threat: "base", tornadoPossible: false })).toContain("A severe thunderstorm warning needs 1 inch hail or 58 mph wind");
    expect(draftProblems({ kind: "SPS", polygon, minutes: 30, hail: 1, wind: 0, threat: "base", tornadoPossible: false })).toContain("Severe hail or wind needs a severe thunderstorm warning");
    expect(draftProblems({ kind: "TOR", polygon, minutes: 30, hail: 0, wind: 0, threat: "destructive", tornadoPossible: false })).toContain("That damage threat isn't available for this product");
    expect(draftProblems({ kind: "TOR", polygon, minutes: 25, hail: 0, wind: 0, threat: "base", tornadoPossible: false })).toContain("Pick a duration from the list");
  });

  it("rejects polygons that are too big, too small or crossed, and junk place names", () => {
    const huge = closeRing([
      [-100, 33],
      [-94, 33],
      [-94, 38],
      [-100, 38],
    ]);
    expect(issueSchema.safeParse({ kind: "SVR", ...base, polygon: huge }).success).toBe(false);
    const tiny = closeRing([
      [-97.44, 35.22],
      [-97.43, 35.22],
      [-97.43, 35.23],
    ]);
    expect(issueSchema.safeParse({ kind: "SVR", ...base, polygon: tiny }).success).toBe(false);
    expect(issueSchema.safeParse({ kind: "SVR", ...base, place: "<script>" }).success).toBe(false);
    expect(issueSchema.safeParse({ kind: "SVR", ...base, hail: 1.1 }).success).toBe(false);
  });
});

describe("WarnGen product text", () => {
  const w: WarningTextInput = {
    kind: "TOR",
    number: 12,
    polygon: closeRing([
      [-97.5, 35.1],
      [-97.2, 35.1],
      [-97.2, 35.4],
      [-97.5, 35.4],
    ]),
    issuedAt: Date.parse("2026-05-06T22:42:00Z"),
    expiresAt: Date.parse("2026-05-06T23:15:00Z"),
    revision: 0,
    cancelledAt: null,
    storm: { lat: 35.22, lon: -97.44, t: Date.parse("2026-05-06T22:40:00Z") },
    motion: { headingDeg: 45, speedKt: 26 },
    basis: "radar",
    hail: 1,
    wind: 0,
    tornadoPossible: false,
    threat: "considerable",
    notes: "Wall cloud reported by two spotters.",
    place: "Norman, OK",
    locations: ["Norman", "Moore", "Noble"],
    issuer: { username: "stormy", displayName: "Stormy" },
  };

  it("reads like a WarnGen product but says it is unofficial", () => {
    const text = warningText(w, { timeZone: "America/Chicago" });
    expect(text.startsWith(UNOFFICIAL_BANNER)).toBe(true);
    expect(text).toContain("Spotter Tornado Warning #12");
    expect(text).toContain("* Until 6:15 PM CDT.");
    expect(text).toContain("* At 5:40 PM CDT, a severe thunderstorm capable of producing a tornado was located near Norman, OK, moving northeast at 30 mph.");
    expect(text).toContain("HAZARD...Tornado and quarter size hail.");
    expect(text).toContain("SOURCE...Radar indicated rotation.");
    expect(text).toContain("...THIS IS A PARTICULARLY DANGEROUS SITUATION. TAKE COVER NOW...");
    expect(text).toContain("Norman, Moore and Noble.");
    expect(text).toContain("Spotter notes: Wall cloud reported by two spotters.");
    expect(text).toContain("TIME...MOT...LOC 2240Z 225DEG 26KT 3522 9744");
    expect(text).toContain("TORNADO...RADAR INDICATED");
    expect(text).toContain("TORNADO DAMAGE THREAT...CONSIDERABLE");
    expect(text).toContain("MAX HAIL SIZE...1.00 IN");
    expect(text.trim().endsWith("@stormy")).toBe(true);
  });

  it("says when it was cancelled", () => {
    const text = warningText({ ...w, cancelledAt: Date.parse("2026-05-06T22:58:00Z") }, { timeZone: "America/Chicago" });
    expect(text).toContain("has been cancelled as of 5:58 PM CDT");
    expect(text).not.toContain("HAZARD...");
  });

  it("names products", () => {
    expect(productName("SPS")).toBe("Spotter Significant Weather Advisory");
    expect(productName("FFW", 3)).toBe("Spotter Flash Flood Warning #3");
  });
});
