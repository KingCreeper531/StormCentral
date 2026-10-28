import { describe, expect, it } from "vitest";
import { haversineKm } from "../../geo";
import { centres } from "./polar";
import { findTds, MEMBERSHIP, ptdsAt, PTDS_WEIGHTS, ramp, trapezoid, type TdsArea } from "./tds";
import { polarSweep, xyOf } from "./test-sweeps";

describe("PTDS fuzzy functions", () => {
  it("ramp and trapezoid hit 0 and 1 at their corners", () => {
    expect(ramp(25, 25, 35)).toBe(0);
    expect(ramp(30, 25, 35)).toBe(0.5);
    expect(ramp(35, 25, 35)).toBe(1);
    expect(ramp(-5, 25, 35)).toBe(0);
    expect(trapezoid(0, 0, 0.2, 0.85, 0.92)).toBe(0);
    expect(trapezoid(0.1, 0, 0.2, 0.85, 0.92)).toBeCloseTo(0.5);
    expect(trapezoid(0.2, 0, 0.2, 0.85, 0.92)).toBe(1);
    expect(trapezoid(0.85, 0, 0.2, 0.85, 0.92)).toBe(1);
    expect(trapezoid(0.885, 0, 0.2, 0.85, 0.92)).toBeCloseTo(0.5);
    expect(trapezoid(0.92, 0, 0.2, 0.85, 0.92)).toBe(0);
    expect(trapezoid(0.99, 0, 0.2, 0.85, 0.92)).toBe(0);
  });

  it("uses the TDS corners for each moment", () => {
    expect([24, 25, 30, 35, 60].map(MEMBERSHIP.ref)).toEqual([0, 0, 0.5, 1, 1]);
    expect([0, 0.2, 0.5, 0.85, 0.92, 0.97].map(MEMBERSHIP.cc)).toEqual([0, 1, 1, 1, 0, 0]);
    expect([-3.5, -2, 0, 1.5, 2.5, 4].map(MEMBERSHIP.zdr)).toEqual([0, 1, 1, 1, 0, 0]);
    expect(MEMBERSHIP.zdr(-2.75)).toBeCloseTo(0.5);
    expect(MEMBERSHIP.zdr(2)).toBeCloseTo(0.5);
    expect([0.5, 1, 1.5, -1.5].map(MEMBERSHIP.nrot)).toEqual([0, 0.5, 1, 1]);
    expect([4, 6, 8].map(MEMBERSHIP.sw)).toEqual([0, 0.5, 1]);
  });

  it("weighs them to 100 %, and debris-like echo without rotation stays under the signature threshold", () => {
    const w = PTDS_WEIGHTS;
    expect(w.ref + w.cc + w.zdr + w.nrot + w.sw).toBeCloseTo(1, 10);
    expect(ptdsAt(50, 0.5, 0, 2, 9)).toBeCloseTo(100);
    // Birds or clutter: Z, CC and ZDR all debris-like, no rotation.
    expect(ptdsAt(40, 0.5, 0.5)).toBeCloseTo(90);
    expect(ptdsAt(40, 0.5, 0.5, 0.2, 2)).toBeCloseTo(90);
    // Rain: high CC.
    expect(ptdsAt(45, 0.98, 1.5, 2, 9)).toBeCloseTo(30 + 20 + 10);
    expect(ptdsAt(NaN, 0.5, 0)).toBeNaN();
    expect(ptdsAt(40, NaN, 0)).toBeNaN();
  });
});

/** A 0.5° grid with PTDS 99 % on the gates `hit` picks (radial index, gate index), 0 elsewhere. */
function field(hit: (r: number, g: number) => boolean, nrotAt: (az: number, km: number) => number = () => 1.5) {
  const grid = polarSweep(() => 0, 0, 1, 1, { gates: 400 });
  const G = grid.nGates;
  const ptds = new Float32Array(grid.nRadials * G);
  const nrot = new Float32Array(grid.nRadials * G);
  const c = centres(grid);
  for (let r = 0; r < grid.nRadials; r++)
    for (let g = 0; g < G; g++) {
      ptds[r * G + g] = hit(r, g) ? 99 : 0;
      nrot[r * G + g] = nrotAt(c[r]!, grid.firstGateKm + g * grid.gateKm);
    }
  return { grid, ptds, nrot };
}

/** Gate index at range `km` (2.125 km first gate, 250 m gates). */
const gateOf = (km: number) => Math.round((km - 2.125) / 0.25);

describe("TDS detection", () => {
  it("needs runs of 0.75 km along the radial", () => {
    // 3 radials × 2 gates (0.5 km runs): nothing. 3 × 3 (0.75 km): one area of 9 gates.
    const g0 = gateOf(40);
    const short = field((r, g) => r >= 100 && r < 103 && g >= g0 && g < g0 + 2);
    expect(findTds(short.grid, short.ptds, short.nrot)).toEqual([]);
    const ok = field((r, g) => r >= 100 && r < 103 && g >= g0 && g < g0 + 3);
    const found = findTds(ok.grid, ok.ptds, ok.nrot);
    expect(found).toHaveLength(1);
    expect(found[0]!.bins).toBe(9);
    expect(found[0]!.maxPtds).toBe(99);
    // 9 gates of 0.25 km × (40 km × 0.5°).
    expect(found[0]!.areaKm2).toBeCloseTo(9 * 0.25 * 40.375 * 0.5 * (Math.PI / 180) * Math.cos(0.5 * (Math.PI / 180)), 2);
  });

  it("needs 9 gates in an area", () => {
    const g0 = gateOf(40);
    const small = field((r, g) => r >= 100 && r < 102 && g >= g0 && g < g0 + 4);
    expect(findTds(small.grid, small.ptds, small.nrot)).toEqual([]);
  });

  it("joins runs within 10 km into one area, and not further apart", () => {
    const g0 = gateOf(40);
    // Two 2-radial × 3-gate patches (6 gates each, too small alone) 8 km apart along the radial, then 12 km apart.
    for (const [gap, want] of [
      [8, 1],
      [12, 0],
    ] as const) {
      const g1 = g0 + 2 + Math.round(gap / 0.25);
      const two = field((r, g) => r >= 100 && r < 102 && ((g >= g0 && g < g0 + 3) || (g >= g1 && g < g1 + 3)));
      const found = findTds(two.grid, two.ptds, two.nrot);
      expect(found, `${gap} km`).toHaveLength(want);
      if (want) expect(found[0]!.bins).toBe(12);
    }
  });

  it("puts the marker at the area's centroid", () => {
    const g0 = gateOf(40);
    const ok = field((r, g) => r >= 100 && r < 103 && g >= g0 && g < g0 + 3);
    const a = findTds(ok.grid, ok.ptds, ok.nrot)[0]!;
    // Radial 101's centre (50.75°), the middle gate's range.
    const [x, y] = xyOf(50.75, 2.125 + (g0 + 1) * 0.25);
    expect(a.x).toBeCloseTo(x * Math.cos(0.5 * (Math.PI / 180)), 2);
    expect(a.y).toBeCloseTo(y * Math.cos(0.5 * (Math.PI / 180)), 2);
    expect(haversineKm({ lat: ok.grid.lat, lon: ok.grid.lon }, a)).toBeCloseTo(Math.hypot(a.x, a.y), 1);
  });

  it("only flags debris with NROT of 1 or more within 3 km", () => {
    const g0 = gateOf(40);
    const at = (r: number, g: number) => r >= 100 && r < 103 && g >= g0 && g < g0 + 3;
    const [cx, cy] = xyOf(50.75, 40.375);
    const spot = (dKm: number, value: number) => (az: number, km: number) => {
      const [x, y] = xyOf(az, km);
      return Math.hypot(x - (cx + dKm), y - cy) < 0.3 ? value : 0.2;
    };
    const flagged = (f: ReturnType<typeof field>): TdsArea[] => findTds(f.grid, f.ptds, f.nrot);
    expect(flagged(field(at, () => 0.8))).toEqual([]);
    expect(flagged(field(at, spot(2, 1.2)))).toHaveLength(1);
    expect(flagged(field(at, spot(2, -1.4)))[0]!.nrot).toBeCloseTo(-1.4);
    expect(flagged(field(at, spot(5, 1.2)))).toEqual([]);
    // No velocity at all: nothing is flagged.
    const f = field(at);
    expect(findTds(f.grid, f.ptds, null)).toEqual([]);
  });
});
