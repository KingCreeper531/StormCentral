import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { destination, haversineKm } from "../../geo";
import { debris, deriveKey, deriveLevel2, markTilts } from "./derive";
import { gunzipIfNeeded } from "./gzip";
import { parseLevel2 } from "./level2";
import { NROT_MIN_KM, nrotField } from "./nrot";
import { gateValues } from "./polar";
import { KT, polarSweep, random, rankine, xyOf } from "./test-sweeps";

const DEG = Math.PI / 180;

/**
 * One super-res tilt of a tornadic storm: rain all round out to 150 km, a
 * 60 m/s tornado 40 km out at 210° with a debris ball 0.8 km across on it,
 * and clutter-like echo (low CC, no rotation) 30 km out at 120°.
 */
function storm(seed = 1) {
  const rnd = random(seed);
  const [tx, ty] = xyOf(210.25, 40);
  const [cx, cy] = xyOf(120.25, 30);
  const where = (a: number, km: number) => {
    const [x, y] = xyOf(a, km);
    return { tor: Math.hypot(x - tx, y - ty), clutter: Math.hypot(x - cx, y - cy) };
  };
  const echo = (km: number) => km < 150;
  const ref = polarSweep((a, km) => (echo(km) ? (where(a, km).tor < 0.8 ? 48 : 40) + 2 * rnd() : null), -32, 94.5, 0.5, { gates: 1832 });
  const rho = polarSweep((a, km) => {
    if (!echo(km)) return null;
    const w = where(a, km);
    return w.tor < 0.8 ? 0.6 + 0.1 * rnd() : w.clutter < 2 ? 0.55 : 0.97 + 0.02 * rnd();
  }, 0.2083, 1.05, 0.00333, { gates: 1192 });
  const zdr = polarSweep((a, km) => (echo(km) ? (where(a, km).tor < 0.8 ? 0.2 * rnd() : 1.5 + 0.5 * rnd()) : null), -13, 20, 0.03125, { gates: 1192 });
  const vortex = rankine(210.25, 40, 0.5, 60);
  // The Doppler scan of a split cut: its own radials (starting a quarter-degree on).
  const vel = polarSweep((a, km) => (echo(km) ? (vortex(a, km) + 15 * Math.cos((a - 60) * DEG) + (rnd() - 0.5)) * KT : null), -250, 250, 0.97, { gates: 1192, start: 0.25 });
  const sw = polarSweep((a, km) => (echo(km) ? (where(a, km).tor < 1.5 ? 9 : 2) * KT : null), 0, 64, 0.97, { gates: 1192, start: 0.25 });
  return { ref, rho, zdr, vel, sw, tornado: destination({ lat: ref.lat, lon: ref.lon }, 210.25, 40 * Math.cos(0.5 * DEG)) };
}

describe("debris signatures, end to end", () => {
  it("finds the tornado's debris ball and leaves rain and clutter alone", () => {
    const s = storm();
    const d = debris({ ref: s.ref, rho: s.rho, zdr: s.zdr, sw: s.sw, nrot: { grid: s.vel, values: nrotField(s.vel) } });
    expect(d.grid).toBe(s.rho);
    expect(d.areas).toHaveLength(1);
    const a = d.areas[0]!;
    expect(haversineKm(a, s.tornado)).toBeLessThan(0.5);
    expect(a.maxPtds).toBeGreaterThan(95);
    expect(a.nrot).toBeGreaterThan(1.5);
    expect(a.areaKm2).toBeGreaterThan(0.5);
    expect(a.areaKm2).toBeLessThan(3);
    // The clutter is debris-like on Z, CC and ZDR alone (90 %), but not a signature.
    const v = d.ptds;
    let clutterMax = 0;
    const [cx, cy] = xyOf(120.25, 30);
    for (let r = 0; r < s.rho.nRadials; r++)
      for (let g = 0; g < s.rho.nGates; g++) {
        const [x, y] = xyOf(s.rho.azStart[r]! + 0.25, s.rho.firstGateKm + g * s.rho.gateKm);
        if (Math.hypot(x - cx, y - cy) < 1.5) clutterMax = Math.max(clutterMax, v[r * s.rho.nGates + g]!);
      }
    expect(clutterMax).toBeGreaterThan(85);
    expect(clutterMax).toBeLessThan(95);
  });

  it("lists the tilts a signature shows on: the shown one, and those above with one within 5 km", () => {
    const area = (x: number, y: number) => ({ lat: 0, lon: 0, x, y, maxPtds: 97, areaKm2: 1, bins: 12, nrot: 2 });
    const marks = markTilts(0.5, [area(10, 10), area(-30, 5)], [
      { angle: 0.9, areas: [area(11, 13), area(-30, 20)] },
      { angle: 1.3, areas: [area(14, 10)] },
    ]);
    expect(marks.map((m) => m.tilts)).toEqual([[0.5, 0.9, 1.3], [0.5]]);
    expect(marks[0]).not.toHaveProperty("x");
  });

  it("works out NROT and PTDS for a super-res tilt quickly", () => {
    const s = storm(2);
    const run = () => debris({ ref: s.ref, rho: s.rho, zdr: s.zdr, sw: s.sw, nrot: { grid: s.vel, values: nrotField(s.vel) } });
    run();
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      run();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`NROT + PTDS + TDS, 720 radials: median ${times[2]!.toFixed(0)} ms`);
    // Around 150 ms on a laptop; generous for slow CI machines.
    expect(times[2]).toBeLessThan(600);
  });
});

describe("derived Level II products on a real volume (KTLX 19 Oct 2026, clear air and showers)", () => {
  const file = new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "KTLX_cut1_V06")));

  it("NROT stays small in ordinary echo", () => {
    const r = deriveLevel2(file, "KTLX_cut1_V06", 0.5, { kind: "nrot" });
    const v = gateValues(r.sweep!);
    let n = 0, big = 0, extreme = 0;
    for (const x of v) {
      if (x !== x) continue;
      n++;
      if (Math.abs(x) >= 1) big++;
      if (Math.abs(x) >= 2.5) extreme++;
    }
    expect(n).toBeGreaterThan(10_000);
    // No storms in it: a few percent of noisy gates reach 1, hardly any 2.5.
    expect(big / n).toBeLessThan(0.08);
    expect(extreme / n).toBeLessThan(0.015);
  });

  it("PTDS is high only in non-meteorological echo, and no signature is flagged", () => {
    const r = deriveLevel2(file, "KTLX_cut1_V06", 0.5, { kind: "tds" });
    const rho = parseLevel2(file, "RHO", 0.5).sweep!;
    expect(r.sweep!.nRadials).toBe(rho.nRadials);
    expect(r.sweep!.nGates).toBe(rho.nGates);
    expect(r.marks).toEqual([]);
    const p = gateValues(r.sweep!);
    const cc = gateValues(rho);
    let rain = 0, rainHigh = 0, over95 = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i]! > 95) over95++;
      if (cc[i]! >= 0.97) {
        rain++;
        if (p[i]! > 60) rainHigh++;
      }
    }
    expect(rain).toBeGreaterThan(1000);
    expect(rainHigh).toBe(0);
    expect(over95).toBeLessThan(50);
  });

  it("SRV is the dealiased velocity less the motion along each beam, and the products are cached per volume", () => {
    const motion = { kind: "srv", towardDeg: 60, speedKt: 30 } as const;
    const a = deriveLevel2(file, "KTLX_cut1_V06", 0.5, motion);
    const vel = parseLevel2(file, "VEL", 0.5).sweep!;
    const v = gateValues(vel);
    const s = gateValues(a.sweep!);
    for (let i = 0; i < v.length; i += 997) {
      if (v[i] !== v[i]) continue;
      const az = vel.azStart[(i / vel.nGates) | 0]! + vel.azWidth[0]! / 2;
      expect(Math.abs(s[i]! - (v[i]! - 30 * Math.cos((az - 60) * DEG)))).toBeLessThan(1);
    }
    // A copy each time (the caller moves it to the main thread).
    const b = deriveLevel2(file, "KTLX_cut1_V06", 0.5, motion);
    expect(b.sweep).not.toBe(a.sweep);
    expect(b.sweep!.data).toEqual(a.sweep!.data);
    expect(deriveKey(motion)).toBe("srv60/30");
    expect(deriveKey({ kind: "srv", towardDeg: 359.6, speedKt: 30.2 })).toBe("srv0/30");
  });
});

describe("derived Level II products on a volume from before dual-pol (KTLX 10 May 2005)", () => {
  const site = { lat: 35.333, lon: -97.278 };
  const read = () => gunzipIfNeeded(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "KTLX20050510_000351_cut12.gz"))));

  it("says there's no dual-pol data for debris", async () => {
    const r = deriveLevel2(await read(), "KTLX20050510", 0.5, { kind: "tds" }, { site });
    expect(r.sweep).toBeNull();
    expect(r.error).toBe("This volume has no dual-pol data");
  });

  it("works out NROT on 1° radials (5 × 5 patch), blank next to the radar", async () => {
    const r = deriveLevel2(await read(), "KTLX20050510", 0.5, { kind: "nrot" }, { site });
    const s = r.sweep!;
    const v = gateValues(s);
    let n = 0, extreme = 0;
    for (let i = 0; i < v.length; i++) {
      if (v[i] !== v[i]) continue;
      n++;
      if (Math.abs(v[i]!) >= 2.5) extreme++;
      expect(s.firstGateKm + (i % s.nGates) * s.gateKm).toBeGreaterThanOrEqual(NROT_MIN_KM);
    }
    expect(n).toBeGreaterThan(90_000);
    expect(extreme / n).toBeLessThan(0.0005);
  });
});
