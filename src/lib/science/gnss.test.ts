import { describe, expect, it } from "vitest";
import { trackSatellites, visibilityAt, visibilityTimeline, type GnssElementSet } from "./gnss";

// A synthetic GPS-like constellation: 6 planes × 4 slots, 55° inclination, ~12 h orbits.
const epoch = "2026-10-01T00:00:00.000000";
const sets: GnssElementSet[] = [];
for (let plane = 0; plane < 6; plane++) {
  for (let slot = 0; slot < 4; slot++) {
    sets.push({
      constellation: "GPS",
      omm: {
        OBJECT_NAME: `TEST ${plane}${slot}`,
        OBJECT_ID: `2026-0${plane}${slot}A`,
        EPOCH: epoch,
        MEAN_MOTION: 2.00563,
        ECCENTRICITY: 0.005,
        INCLINATION: 55,
        RA_OF_ASC_NODE: plane * 60,
        ARG_OF_PERICENTER: 0,
        MEAN_ANOMALY: slot * 90 + plane * 15,
        NORAD_CAT_ID: 90000 + plane * 10 + slot,
        ELEMENT_SET_NO: 999,
        REV_AT_EPOCH: 1,
        BSTAR: 0,
        MEAN_MOTION_DOT: 0,
        MEAN_MOTION_DDOT: 0,
      },
    });
  }
}

describe("gnss", () => {
  const sats = trackSatellites([...sets, { constellation: "GPS", omm: { OBJECT_NAME: "BROKEN" } as never }]);

  it("skips malformed element sets", () => {
    expect(sats).toHaveLength(24);
  });

  it("sees a plausible number of satellites with sane geometry", () => {
    const v = visibilityAt(sats, new Date("2026-10-02T12:00:00Z"), 41.88, -87.63);
    expect(v.count).toBeGreaterThanOrEqual(4);
    expect(v.count).toBeLessThanOrEqual(14);
    expect(v.byConstellation.GPS).toBe(v.count);
    for (const s of v.sats) {
      expect(s.elevationDeg).toBeGreaterThanOrEqual(10);
      expect(s.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(s.azimuthDeg).toBeLessThanOrEqual(360);
    }
    expect(v.dop === null || v.dop.pdop > 0).toBe(true);
  });

  it("builds an hourly timeline", () => {
    const t = visibilityTimeline(sats, new Date("2026-10-02T12:34:00Z"), 6, 41.88, -87.63);
    expect(t).toHaveLength(6);
    expect(t[1]!.time - t[0]!.time).toBe(3_600_000);
  });
});
