import { describe, expect, it } from "vitest";
import type { StormMotion } from "./api/types";
import { destination, haversineKm } from "./geo";
import { coneHalfKm, stormNow, stormPaths, townsInPath, type PathPlace } from "./storm-path";

const NOW = Date.parse("2026-05-20T22:00:00Z");
// Moving due east at 30 kt (55.56 km/h) from near Norman, OK, as of now.
const EAST: StormMotion = { time: new Date(NOW).toISOString(), headingDeg: 90, speedKt: 30, positions: [[-97.44, 35.22]] };
const start = { lat: 35.22, lon: -97.44 };
const ahead = (km: number, sideKm = 0, name = "Town"): PathPlace => {
  const p = destination(start, 90, km);
  const q = sideKm ? destination(p, sideKm > 0 ? 0 : 180, Math.abs(sideKm)) : p;
  return { name, size: 1, lat: q.lat, lon: q.lon };
};

describe("stormPaths", () => {
  it("runs an hour ahead with a mark every 15 minutes, at the right places and times", () => {
    const [path] = stormPaths(EAST, NOW);
    expect(path!.marks.map((m) => m.minutes)).toEqual([0, 15, 30, 45, 60]);
    expect(path!.marks[4]!.at).toBe(NOW + 3_600_000);
    // 30 kt for an hour is 55.6 km.
    expect(haversineKm(start, path!.marks[4]!)).toBeCloseTo(55.56, 1);
    expect(path!.line).toHaveLength(13);
  });

  it("widens the cone with distance and closes it", () => {
    const [path] = stormPaths(EAST, NOW);
    const ring = path!.cone;
    expect(ring[0]).toEqual(ring.at(-1));
    // Left side first (north of an eastbound storm): 1.5 km wide at the storm, 1.5 + 0.2 × 55.6 at the end.
    expect(haversineKm({ lon: ring[0]![0], lat: ring[0]![1] }, start)).toBeCloseTo(coneHalfKm(0), 1);
    const end = path!.marks[4]!;
    expect(haversineKm({ lon: ring[12]![0], lat: ring[12]![1] }, end)).toBeCloseTo(coneHalfKm(55.56), 0);
  });

  it("moves the storm on from the warning's time, and stops at the warning's end", () => {
    const issued = { ...EAST, time: new Date(NOW - 20 * 60_000).toISOString() };
    expect(haversineKm(stormNow(issued, NOW)[0]!, start)).toBeCloseTo(18.52, 1);
    const [short] = stormPaths(EAST, NOW, NOW + 25 * 60_000);
    expect(short!.marks.map((m) => m.minutes)).toEqual([0, 15]);
    expect(stormPaths(EAST, NOW, NOW + 2 * 60_000)).toEqual([]);
  });

  it("draws nothing for a storm that's barely moving, and one path per reference point", () => {
    expect(stormPaths({ ...EAST, speedKt: 2 }, NOW)).toEqual([]);
    expect(stormPaths({ ...EAST, positions: [[-97.44, 35.22], [-97.6, 34.9]] }, NOW)).toHaveLength(2);
  });
});

describe("townsInPath", () => {
  it("finds the towns inside the cone, soonest first, with arrival times", () => {
    const towns = townsInPath(EAST, [ahead(40, 0, "Later"), ahead(20, 2, "Sooner"), ahead(30, 15, "Off to the side"), ahead(-10, 0, "Behind"), ahead(80, 0, "Too far")], NOW);
    expect(towns.map((t) => t.name)).toEqual(["Sooner", "Later"]);
    // 20 km at 55.56 km/h: 21.6 minutes.
    expect(towns[0]!.minutes).toBeCloseTo(21.6, 0);
    expect(towns[0]!.at).toBeCloseTo(NOW + towns[0]!.minutes * 60_000, -2);
  });

  it("allows more room to the side the farther out a town is", () => {
    // 3 km off the line: outside the cone 5 km out (2.5 km wide), inside 40 km out (9.5 km wide).
    expect(townsInPath(EAST, [ahead(5, 3)], NOW)).toEqual([]);
    expect(townsInPath(EAST, [ahead(40, 3)], NOW)).toHaveLength(1);
  });

  it("stops at the warning's end and counts a town on two tracks once", () => {
    expect(townsInPath(EAST, [ahead(40)], NOW, NOW + 30 * 60_000)).toEqual([]);
    const two: StormMotion = { ...EAST, positions: [[-97.44, 35.22], [-97.44, 35.225]] };
    expect(townsInPath(two, [ahead(20)], NOW)).toHaveLength(1);
  });

  it("puts the bigger place first when two are reached at the same minute", () => {
    const p = ahead(20);
    const towns = townsInPath(EAST, [{ ...p, name: "Village", size: 2 }, { ...p, name: "City", size: 0 }], NOW);
    expect(towns.map((t) => t.name)).toEqual(["City", "Village"]);
  });
});
