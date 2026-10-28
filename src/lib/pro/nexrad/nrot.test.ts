import { describe, expect, it } from "vitest";
import { clockwise } from "./dealias";
import { azimuthalShear, median3x3, nrotField, patchHalf, shearThreshold } from "./nrot";
import { gateValues } from "./polar";
import { gateAt, KT, polarSweep, random, rankine } from "./test-sweeps";

const DEG = Math.PI / 180;

/** Shear along the range ring through a vortex at (az0, km0), every radial within ±spanKm across the beam. */
function profile(shear: Float32Array, s: ReturnType<typeof polarSweep>, az0: number, km0: number, spanKm: number) {
  const out: { x: number; v: number }[] = [];
  const width = s.azWidth[0]!;
  for (let d = -spanKm; d <= spanKm + 1e-9; d += km0 * width * DEG) {
    const az = az0 + d / km0 / DEG;
    out.push({ x: d, v: shear[gateAt(s, az, km0)]! });
  }
  return out;
}

describe("LLSD azimuthal shear", () => {
  // A cyclonic vortex, 2 km core, 20 m/s, 30 km out at 45° (super-res grid, fine value steps).
  const vortex = rankine(45.25, 30, 2, 20);
  const sweep = polarSweep((a, km) => vortex(a, km) * KT, -150, 150, 0.05, { gates: 400 });
  const u = gateValues(sweep, 1 / KT);

  it("is positive for cyclonic rotation, about vmax / R in the core", () => {
    const shear = azimuthalShear(u, sweep);
    const centre = shear[gateAt(sweep, 45.25, 30)]!;
    expect(centre).toBeGreaterThan(0);
    expect(centre).toBeCloseTo(20 / 2000, 3);
    const anti = rankine(45.25, 30, 2, -20);
    const back = polarSweep((a, km) => anti(a, km) * KT, -150, 150, 0.05, { gates: 400 });
    expect(azimuthalShear(gateValues(back, 1 / KT), back)[gateAt(back, 45.25, 30)]!).toBeCloseTo(-centre, 4);
  });

  it("is flat across the core, symmetric, and changes sign at the core radius", () => {
    const shear = azimuthalShear(u, sweep);
    const p = profile(shear, sweep, 45.25, 30, 6);
    const peak = Math.max(...p.map((q) => q.v));
    // Symmetric about the centre.
    for (const q of p) {
      const mirror = p.reduce((a, b) => (Math.abs(b.x + q.x) < Math.abs(a.x + q.x) ? b : a));
      expect(Math.abs(q.v - mirror.v)).toBeLessThan(0.08 * peak);
    }
    // Within the core (less half a patch) close to the peak; outside, anticyclonic shear.
    for (const q of p) if (Math.abs(q.x) < 0.9) expect(q.v).toBeGreaterThan(0.85 * peak);
    for (const q of p) if (Math.abs(q.x) > 3.2) expect(q.v).toBeLessThan(0);
    // The sign changes at ±R (2 km), within a gate or two of it.
    const right = p.find((q, i) => q.x > 0 && q.v < 0 && p[i - 1]!.v >= 0)!;
    const left = [...p].reverse().find((q, i, a) => q.x < 0 && q.v < 0 && a[i - 1]!.v >= 0)!;
    expect(Math.abs(right.x - 2)).toBeLessThan(0.4);
    expect(Math.abs(left.x + 2)).toBeLessThan(0.4);
  });

  it("uses a 9 × 9 patch on 0.5° data and 5 × 5 on 1°", () => {
    expect(patchHalf(sweep)).toBe(4);
    expect(patchHalf(polarSweep(() => 0, 0, 1, 1, { radials: 360, gates: 10 }))).toBe(2);
  });

  it("falls back to the gate pair either side where the patch has gaps", () => {
    // Only every third radial has data: too few for a fit anywhere, but each gate has a neighbour either side.
    const sparse = polarSweep((a, km) => (Math.round((a - 0.25) / 0.5) % 3 === 0 ? 0.001 * (a * DEG * km * 1000) : null), -150, 150, 0.0005, { gates: 200 });
    const v = gateValues(sparse);
    const shear = azimuthalShear(v, sparse);
    const i = gateAt(sparse, 90.25, 30);
    expect(v[i]).not.toBeNaN();
    // u = 0.001 s⁻¹ × arc length: the pair gives 0.001.
    expect(shear[i]).toBeCloseTo(0.001, 5);
    // A gate with nothing on one side within the patch has no shear.
    const lone = polarSweep((a, km) => (Math.abs(a - 90.25) < 0.01 && km < 40 ? 5 : null), -150, 150, 0.05, { gates: 200 });
    const s2 = azimuthalShear(gateValues(lone), lone);
    expect(s2[gateAt(lone, 90.25, 30)]).toBeNaN();
  });
});

describe("range normalisation", () => {
  it("falls off with range, never rising", () => {
    let prev = Infinity;
    for (let km = 0; km <= 460; km += 5) {
      const t = shearThreshold(km);
      expect(t).toBeLessThan(prev);
      expect(t).toBeGreaterThan(0);
      prev = t;
    }
    expect(shearThreshold(30)).toBeCloseTo(0.01, 4);
    expect(shearThreshold(100)).toBeCloseTo(0.005, 4);
  });

  it("reads a 40 kt mesocyclone 4 km across as about 1 at 30 and at 100 km, and a tight, violent vortex as extreme", () => {
    for (const km of [30, 100]) {
      const meso = rankine(60.25, km, 2, 20);
      const s = polarSweep((a, r) => meso(a, r) * KT, -150, 150, 0.05, { gates: Math.round(km * 4 + 100) });
      const n = nrotField(s)[gateAt(s, 60.25, km)]!;
      expect(n).toBeGreaterThan(0.75);
      expect(n).toBeLessThan(1.35);
    }
    const tornado = rankine(60.25, 30, 0.5, 60);
    const s = polarSweep((a, r) => tornado(a, r) * KT, -250, 250, 0.05, { gates: 220 });
    expect(nrotField(s)[gateAt(s, 60.25, 30)]!).toBeGreaterThan(2.5);
  });
});

describe("NROT median filter", () => {
  const R = 6;
  const G = 8;
  const order = clockwise({ nRadials: R, azStart: Float32Array.from({ length: R }, (_, i) => i * 60), azWidth: new Float32Array(R).fill(60) });

  it("removes a lone spike and keeps a step edge", () => {
    const v = new Float32Array(R * G).fill(5);
    v[2 * G + 4] = 80;
    for (let r = 0; r < R; r++) for (let g = 5; g < G; g++) v[r * G + g] = -10;
    const m = median3x3(v, R, G, order.prev, order.next);
    expect(m[2 * G + 4]).toBe(5);
    expect(m[2 * G + 3]).toBe(5);
    expect(m[2 * G + 6]).toBe(-10);
    expect(m[2 * G + 5]).toBe(-10);
  });

  it("leaves empty gates empty, ignores empty neighbours, and wraps through north", () => {
    const v = new Float32Array(R * G).fill(NaN);
    v[0 * G + 3] = 1;
    v[(R - 1) * G + 3] = 3;
    v[1 * G + 3] = 2;
    const m = median3x3(v, R, G, order.prev, order.next);
    // Radial 0's neighbours are radial 1 and (across north) radial R − 1: median of 1, 2, 3.
    expect(m[3]).toBe(2);
    expect(m[4]).toBeNaN();
    // Radial 1 sees 1 and 2 (its other neighbour is empty): their mean.
    expect(m[G + 3]).toBe(1.5);
  });
});

describe("NROT timing", () => {
  it("works out a noisy super-res sweep quickly", () => {
    const rnd = random(4);
    const meso = rankine(80, 60, 2, 25);
    const s = polarSweep((a, km) => (rnd() > 0.05 ? (meso(a, km) + 12 * Math.cos((a - 30) * DEG) + 2 * (rnd() - 0.5)) * KT : null), -150, 150, 0.97, { gates: 1192 });
    nrotField(s);
    const times: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      nrotField(s);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`NROT 720 × 1192: median ${times[3]!.toFixed(0)} ms`);
    // Well under 150 ms on a laptop; generous for slow CI machines.
    expect(times[3]).toBeLessThan(450);
  });
});
