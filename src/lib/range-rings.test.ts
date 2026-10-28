import type { LineString, Point } from "geojson";
import { describe, expect, it } from "vitest";
import { haversineKm, type LatLon } from "./geo";
import { bearingLabel, geodesicCircle, greatCircleLine, isRingStep, KM_PER_UNIT, measure, minutesToCover, rangeRings, ringCount } from "./range-rings";

const NORMAN: LatLon = { lat: 35.2226, lon: -97.4395 };
const at = ([lon, lat]: number[]) => ({ lat: lat!, lon: lon! });

describe("range rings", () => {
  it("draws circles of points the same distance from the centre", () => {
    const ring = geodesicCircle(NORMAN, 80, 64);
    expect(ring).toHaveLength(65);
    for (const p of ring) expect(haversineKm(NORMAN, at(p))).toBeCloseTo(80, 6);
    expect(ring[0]![0]).toBeCloseTo(ring.at(-1)![0], 9);
    expect(ring[0]![1]).toBeCloseTo(ring.at(-1)![1], 9);
  });

  it("are wider than tall far north, as a true circle is on the map", () => {
    const c = { lat: 70, lon: 25 };
    const ring = geodesicCircle(c, 100);
    for (const p of ring) expect(haversineKm(c, at(p))).toBeCloseTo(100, 6);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const ratio = (Math.max(...lons) - Math.min(...lons)) / (Math.max(...lats) - Math.min(...lats));
    // 1 / cos(70°) ≈ 2.9: a circle in degrees would be 1.
    expect(ratio).toBeGreaterThan(2.7);
    expect(ratio).toBeLessThan(3.1);
  });

  it("stay in one piece across the antimeridian and around a pole", () => {
    for (const [c, km] of [
      [{ lat: 52, lon: 179.6 }, 150],
      [{ lat: 89.5, lon: 0 }, 200],
    ] as const) {
      const ring = geodesicCircle(c, km);
      for (let i = 1; i < ring.length; i++) expect(Math.abs(ring[i]![0] - ring[i - 1]![0])).toBeLessThan(20);
      for (const p of ring) expect(haversineKm(c, at(p))).toBeCloseTo(km, 5);
    }
  });

  it("put a ring every step in the person's unit, labelled, out to about 250", () => {
    const fc = rangeRings(NORMAN, 25, "mi");
    const rings = fc.features.filter((f) => f.properties?.kind === "ring");
    const labels = fc.features.filter((f) => f.properties?.kind === "label");
    expect(rings).toHaveLength(10);
    expect(labels.map((f) => f.properties?.label)).toEqual(["25 mi", "50 mi", "75 mi", "100 mi", "125 mi", "150 mi", "175 mi", "200 mi", "225 mi", "250 mi"]);
    const first = (rings[0]!.geometry as LineString).coordinates[0]!;
    expect(haversineKm(NORMAN, at(first))).toBeCloseTo(25 * KM_PER_UNIT.mi, 6);
    // Labels sit on their ring, due north of the centre.
    const label = (labels[1]!.geometry as Point).coordinates;
    expect(label[0]).toBeCloseTo(NORMAN.lon, 9);
    expect(haversineKm(NORMAN, at(label))).toBeCloseTo(50 * KM_PER_UNIT.mi, 6);
    expect(fc.features.some((f) => f.properties?.kind === "spoke")).toBe(false);

    expect(ringCount(10)).toBe(10);
    expect(ringCount(50)).toBe(5);
    const km = rangeRings(NORMAN, 50, "km");
    expect(km.features.filter((f) => f.properties?.kind === "label").at(-1)!.properties?.label).toBe("250 km");
    const outer = (km.features.filter((f) => f.properties?.kind === "ring").at(-1)!.geometry as LineString).coordinates[0]!;
    expect(haversineKm(NORMAN, at(outer))).toBeCloseTo(250, 6);
  });

  it("add a spoke every 30° out to the last ring, with its bearing", () => {
    const fc = rangeRings(NORMAN, 50, "mi", true);
    const spokes = fc.features.filter((f) => f.properties?.kind === "spoke");
    expect(spokes).toHaveLength(12);
    expect(fc.features.filter((f) => f.properties?.kind === "spoke-label").map((f) => f.properties?.label)).toEqual(["0°", "30°", "60°", "90°", "120°", "150°", "180°", "210°", "240°", "270°", "300°", "330°"]);
    const east = (spokes[3]!.geometry as LineString).coordinates;
    expect(at(east[0]!)).toEqual(NORMAN);
    expect(haversineKm(NORMAN, at(east.at(-1)!))).toBeCloseTo(250 * KM_PER_UNIT.mi, 6);
    expect(measure(NORMAN, at(east.at(-1)!)).bearing).toBeCloseTo(90, 6);
  });

  it("only takes the offered steps", () => {
    expect(isRingStep(25)).toBe(true);
    expect(isRingStep(30)).toBe(false);
    expect(isRingStep("25")).toBe(false);
  });
});

describe("measuring", () => {
  it("gives the great-circle distance, bearing and compass point", () => {
    const east = measure({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(east.km).toBeCloseTo(111.2, 1);
    expect(east.bearing).toBeCloseTo(90, 9);
    expect(east.compass).toBe("E");
    expect(measure({ lat: 0, lon: 0 }, { lat: -1, lon: 0 }).compass).toBe("S");
    // Norman to Tulsa: about 168 km to the northeast.
    const tulsa = measure(NORMAN, { lat: 36.154, lon: -95.9928 });
    expect(tulsa.km).toBeGreaterThan(160);
    expect(tulsa.km).toBeLessThan(175);
    expect(tulsa.compass).toBe("NE");
    expect(measure(NORMAN, { lat: 35.1, lon: -97.8 }).compass).toBe("WSW");
  });

  it("writes bearings as whole degrees from 0 to 359", () => {
    expect(bearingLabel(245.4)).toBe("245°");
    expect(bearingLabel(359.6)).toBe("0°");
    expect(bearingLabel(-10)).toBe("350°");
  });

  it("draws the line along the great circle", () => {
    const a = { lat: 60, lon: -150 };
    const b = { lat: 60, lon: -100 };
    const line = greatCircleLine(a, b);
    expect(at(line[0]!)).toEqual(a);
    expect(at(line.at(-1)!)).toEqual(b);
    const mid = at(line[Math.floor(line.length / 2)]!);
    // The shortest way between two points on a parallel bows towards the pole.
    expect(mid.lat).toBeGreaterThan(61);
    expect(haversineKm(a, mid) + haversineKm(mid, b)).toBeCloseTo(haversineKm(a, b), 3);
    expect(greatCircleLine(a, a)).toHaveLength(2);
  });

  it("times a storm over the distance at its speed", () => {
    expect(minutesToCover(55.56, 30)).toBeCloseTo(60, 9);
    expect(minutesToCover(10, 2)).toBeNull();
    expect(minutesToCover(10, null)).toBeNull();
  });
});
