import { describe, expect, it } from "vitest";
import { parseEventMotion } from "../science/storm-motion";
import { DEFAULT_SRV_MOTION, meanCellMotion, motionFromText, resolveSrvMotion, stormMotion } from "./storm-tools";

const KTLX = { lat: 35.333, lon: -97.278 };

describe("storm motion for storm-relative velocity", () => {
  it("reads a warning's TIME...MOT...LOC line as a FROM direction", () => {
    const text = "* AT 547 PM CDT...\n\nTIME...MOT...LOC 2247Z 239DEG 36KT 3541 9757\n\nHAZARD...TORNADO.";
    expect(motionFromText(text)).toEqual({ fromDeg: 239, speedKt: 36 });
    expect(motionFromText("no motion here")).toBeNull();
    // The CAP parameter of the same warning already gives the direction it moves toward.
    expect(parseEventMotion("2024-05-21T22:47:00-00:00...storm...239DEG...36KT...3541 9757")!.headingDeg).toBe(59);
  });

  it("averages the cells' motion vectors near the radar", () => {
    const cells = [
      { lat: 35.5, lon: -97.5, motion: { fromDeg: 230, speedKt: 30 } },
      { lat: 35.0, lon: -97.0, motion: { fromDeg: 250, speedKt: 30 } },
      // Too slow to count, and too far away.
      { lat: 35.2, lon: -97.2, motion: { fromDeg: 90, speedKt: 0.5 } },
      { lat: 41.0, lon: -90.0, motion: { fromDeg: 90, speedKt: 50 } },
      { lat: 35.1, lon: -97.1, motion: null },
    ];
    const m = meanCellMotion(cells, KTLX)!;
    expect(m.count).toBe(2);
    expect(m.towardDeg).toBeCloseTo(60, 5);
    expect(m.speedKt).toBeCloseTo(30 * Math.cos((10 * Math.PI) / 180), 5);
    expect(meanCellMotion([], KTLX)).toBeNull();
  });

  it("uses the chosen source, or in auto the cells, then a storm vector, then the warning", () => {
    const cells = { towardDeg: 60, speedKt: 28 };
    const vector = stormMotion({ lat: 35, lon: -98, t: 0 }, { lat: 35, lon: -97.9, t: 600_000 })!;
    const warning = { towardDeg: 59, speedKt: 36 };
    const auto = DEFAULT_SRV_MOTION;
    expect(resolveSrvMotion(auto, { cells, vector, warning })).toEqual({ ...cells, source: "cells" });
    expect(resolveSrvMotion(auto, { vector, warning })!.source).toBe("vector");
    expect(resolveSrvMotion(auto, { warning })).toEqual({ ...warning, source: "warning" });
    expect(resolveSrvMotion(auto, {})).toBeNull();
    // Typed in as FROM 240° at 30 kt: it moves toward 60°.
    expect(resolveSrvMotion({ source: "typed", fromDeg: 240, speedKt: 30 }, { cells })).toEqual({ towardDeg: 60, speedKt: 30, source: "typed" });
    expect(resolveSrvMotion({ ...auto, source: "warning" }, { cells })).toBeNull();
    const v = resolveSrvMotion({ ...auto, source: "vector" }, { vector })!;
    expect(v.towardDeg).toBeCloseTo(90, 0);
    expect(v.speedKt).toBeCloseTo(9.11 / 1.852 / (1 / 6), 0);
  });
});
