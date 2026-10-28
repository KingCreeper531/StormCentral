import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodedValueAt } from "./client";
import { dealiasSweep, velocityFolds } from "./dealias";
import { gunzipIfNeeded } from "./gzip";
import { parseLevel2 } from "./level2";
import type { Sweep } from "./sweep";

const KT = 1.943844;
const DEG = Math.PI / 180;

/** A small deterministic random source (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radial velocity (m/s) of a uniform wind blowing toward `toward`° at `speed`, at azimuth `az`. */
const uniform = (speed: number, toward: number) => (az: number) => speed * Math.cos((az - toward) * DEG);

/** Radial velocity (m/s) of a cyclonic Rankine vortex (core radius `radiusKm`, peak `vmax`) centred at az/km. */
function vortex(az0: number, km0: number, radiusKm: number, vmax: number) {
  const cx = km0 * Math.sin(az0 * DEG);
  const cy = km0 * Math.cos(az0 * DEG);
  return (az: number, km: number) => {
    const px = km * Math.sin(az * DEG);
    const py = km * Math.cos(az * DEG);
    const dx = px - cx;
    const dy = py - cy;
    const rho = Math.hypot(dx, dy);
    if (rho < 1e-6) return 0;
    const vt = rho < radiusKm ? (vmax * rho) / radiusKm : (vmax * radiusKm) / rho;
    // Counter-clockwise: (−dy, dx)/ρ, onto the beam's direction.
    return (vt * (-dy * px + dx * py)) / (rho * km);
  };
}

interface Synth {
  /** Radial velocity (m/s) at azimuth/range, or null for no echo. */
  field: (az: number, km: number) => number | null;
  /** Nyquist velocity (m/s), per azimuth. */
  vn: number | ((az: number) => number);
  radials?: number;
  gates?: number;
  /** Azimuth of the first radial scanned. */
  start?: number;
  /** Gates given as range folded: (az, km) → true. */
  rf?: (az: number, km: number) => boolean;
  /** Radials to leave out (a gap in the sweep): (az) → true. */
  skip?: (az: number) => boolean;
  noise?: number;
  seed?: number;
}

/**
 * A Level II-like velocity sweep (8-bit levels, 0.5 m/s steps, knots) of a
 * field, folded into ±Vn; `truth` holds the unfolded values (knots, NaN where
 * there's no data).
 */
function synth(o: Synth): { sweep: Sweep; truth: Float32Array } {
  const nR0 = o.radials ?? 720;
  const nG = o.gates ?? 1200;
  const width = 360 / nR0;
  const rnd = random(o.seed ?? 1);
  const az: number[] = [];
  for (let k = 0; k < nR0; k++) {
    const a = ((o.start ?? 0) + k * width) % 360;
    if (!o.skip?.(a + width / 2)) az.push(a);
  }
  const nR = az.length;
  const data = new Uint8Array(nR * nG);
  const truth = new Float32Array(nR * nG).fill(NaN);
  const nyquist = new Float32Array(nR);
  const table = new Float32Array(256).fill(NaN);
  for (let i = 2; i < 256; i++) table[i] = ((i - 129) / 2) * KT;
  const firstKm = 2.125;
  const gateKm = 0.25;
  az.forEach((a0, r) => {
    const a = a0 + width / 2;
    const vn = typeof o.vn === "number" ? o.vn : o.vn(a);
    nyquist[r] = vn * KT;
    for (let g = 0; g < nG; g++) {
      const km = firstKm + g * gateKm;
      const i = r * nG + g;
      if (o.rf?.(a, km)) {
        data[i] = 1;
        continue;
      }
      const f = o.field(a, km);
      if (f == null) continue;
      const v = f + (o.noise ?? 0.5) * (rnd() + rnd() + rnd() - 1.5);
      const folded = v - 2 * vn * Math.round(v / (2 * vn));
      const level = Math.max(2, Math.min(255, Math.round(folded * 2) + 129));
      data[i] = level;
      // What the gate holds, unfolded: the quantised value plus the folds taken out.
      truth[i] = table[level]! + (v - folded) * KT;
    }
  });
  const sweep: Sweep = {
    lat: 35.333,
    lon: -97.278,
    heightM: 390,
    time: 0,
    elevation: 0.5,
    nRadials: nR,
    nGates: nG,
    firstGateKm: firstKm,
    gateKm,
    azStart: Float32Array.from(az),
    azWidth: new Float32Array(nR).fill(width),
    data,
    table,
    special: [{ level: 1, label: "RF" }],
    nyquist,
  };
  return { sweep, truth };
}

/**
 * Share of the gates with data (those `where` picks, by azimuth and range) whose dealiased value is within
 * `tol` kt of the truth, and of those that were folded.
 */
function score(out: Sweep, truth: Float32Array, where?: (az: number, km: number) => boolean, tol = 1.2) {
  let n = 0, ok = 0, folded = 0, foldedOk = 0;
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i]!;
    if (Number.isNaN(t)) continue;
    const r = (i / out.nGates) | 0;
    if (where && !where(out.azStart[r]! + out.azWidth[r]! / 2, out.firstGateKm + (i % out.nGates) * out.gateKm)) continue;
    const v = out.table[out.data[i]!]!;
    const good = Math.abs(v - t) <= tol;
    n++;
    if (good) ok++;
    if (Math.abs(t) > out.nyquist![(i / out.nGates) | 0]!) {
      folded++;
      if (good) foldedOk++;
    }
  }
  return { all: ok / n, folded: folded ? foldedOk / folded : 1, n, nFolded: folded };
}

/** An echo out to 230 km with ~8% of gates missing at random, and a clear patch. */
function echo(seed: number) {
  const rnd = random(seed);
  return (az: number, km: number) => km < 230 && rnd() > 0.08 && !(km > 150 && km < 170 && az > 100 && az < 130);
}

describe("velocity dealiasing", () => {
  it("recovers a uniform 40 m/s wind and a rotation couplet folded at Vn 26 m/s", () => {
    const wind = uniform(40, 45);
    const couplet = vortex(45, 60, 2, 30);
    const has = echo(2);
    const { sweep, truth } = synth({ field: (a, km) => (has(a, km) ? wind(a) + couplet(a, km) : null), vn: 26 });
    const out = dealiasSweep(sweep);
    const s = score(out, truth);
    expect(s.nFolded).toBeGreaterThan(s.n * 0.3);
    expect(s.all).toBeGreaterThanOrEqual(0.98);
    expect(s.folded).toBeGreaterThanOrEqual(0.98);
    // The couplet itself, within 6 km of its centre (60 km out at 45°).
    const core = score(out, truth, (a, km) => Math.hypot(km * Math.sin(a * DEG) - 60 * Math.SQRT1_2, km * Math.cos(a * DEG) - 60 * Math.SQRT1_2) < 6);
    expect(core.n).toBeGreaterThan(500);
    expect(core.all).toBeGreaterThanOrEqual(0.98);
    // The couplet's peak (~70 m/s outbound with the wind) is past what 8-bit levels hold: 16-bit, same scale.
    expect(out.data).toBeInstanceOf(Uint16Array);
    let peak = -Infinity;
    for (let i = 0; i < truth.length; i++) if (!Number.isNaN(truth[i]!)) peak = Math.max(peak, out.table[out.data[i]!]!);
    expect(peak / KT).toBeGreaterThan(62);
  });

  it("leaves a field that isn't aliased unchanged", () => {
    const wind = uniform(15, 200);
    const couplet = vortex(300, 40, 2, 8);
    const has = echo(3);
    const { sweep } = synth({ field: (a, km) => (has(a, km) ? wind(a) + couplet(a, km) : null), vn: 26 });
    expect(dealiasSweep(sweep)).toBe(sweep);
    expect(velocityFolds(sweep)!.every((f) => f === 0)).toBe(true);
  });

  it("unfolds through 0°/360° whatever azimuth the scan starts at", () => {
    // Folded sectors centred on north and south; the radials start at 177°, so north is mid-sweep and the
    // array wraps inside the southern one.
    const wind = uniform(45, 0);
    const has = echo(4);
    for (const start of [177, 0.25, 359.5]) {
      const { sweep, truth } = synth({ field: (a, km) => (has(a, km) ? wind(a) : null), vn: 26, start });
      const s = score(dealiasSweep(sweep), truth);
      expect(s.folded).toBeGreaterThanOrEqual(0.98);
      expect(s.all).toBeGreaterThanOrEqual(0.98);
    }
  });

  it("copes with missing gates, a missing wedge of radials and range-folded gates", () => {
    const wind = uniform(38, 120);
    const rnd = random(5);
    const { sweep, truth } = synth({
      field: (a, km) => (km < 200 && rnd() > 0.3 ? wind(a) : null),
      vn: 24,
      // A sweep still being scanned: 40° not there yet.
      skip: (a) => a > 250 && a < 290,
      // Second-trip echo over a band of range in two sectors.
      rf: (a, km) => km > 90 && km < 110 && ((a > 100 && a < 140) || (a > 300 && a < 330)),
    });
    const out = dealiasSweep(sweep);
    const s = score(out, truth);
    expect(s.all).toBeGreaterThanOrEqual(0.98);
    expect(s.folded).toBeGreaterThanOrEqual(0.98);
    // Range-folded and empty gates are kept as they were.
    for (let i = 0; i < sweep.data.length; i++) if (sweep.data[i]! < 2) expect(out.data[i]).toBe(sweep.data[i]);
  });

  it("unfolds each radial with its own Nyquist velocity", () => {
    const wind = uniform(42, 300);
    const has = echo(6);
    const { sweep, truth } = synth({ field: (a, km) => (has(a, km) ? wind(a) : null), vn: (a) => (a < 180 ? 26 : 22) });
    const s = score(dealiasSweep(sweep), truth);
    expect(s.all).toBeGreaterThanOrEqual(0.98);
    expect(s.folded).toBeGreaterThanOrEqual(0.98);
  });

  it("puts a whole sweep back when its biggest area is the folded one", () => {
    // 60 m/s at Vn 26: most of the sweep is folded once or twice.
    const wind = uniform(60, 10);
    const has = echo(7);
    const { sweep, truth } = synth({ field: (a, km) => (has(a, km) ? wind(a) : null), vn: 26 });
    const s = score(dealiasSweep(sweep), truth);
    expect(s.folded).toBeGreaterThanOrEqual(0.98);
    expect(s.all).toBeGreaterThanOrEqual(0.98);
  });

  it("leaves sweeps without Nyquist velocities alone", () => {
    const { sweep } = synth({ field: (a) => uniform(40, 0)(a), vn: 26, radials: 360, gates: 100 });
    const bare = { ...sweep, nyquist: undefined };
    expect(dealiasSweep(bare)).toBe(bare);
  });

  it("gives the cursor readout the unfolded value", () => {
    const wind = uniform(40, 90);
    const { sweep, truth } = synth({ field: (a, km) => (km < 120 ? wind(a) : null), vn: 26, radials: 360, gates: 400, noise: 0 });
    const out = dealiasSweep(sweep);
    // Due east, 50 km out: 40 m/s outbound, shown folded as −12.
    const lat = 35.333;
    const lon = -97.278 + 50 / (111.195 * Math.cos(lat * DEG));
    const r = decodedValueAt(out, lat, lon)!;
    expect(r.value! / KT).toBeCloseTo(40, 0);
    expect(decodedValueAt(sweep, lat, lon)!.value! / KT).toBeCloseTo(-12, 0);
    expect(truth.some((t) => Math.abs(t / KT - 40) < 0.5)).toBe(true);
  });

  it("dealiases a super-res sweep (720 × 1200 gates) quickly", () => {
    const wind = uniform(40, 45);
    const couplet = vortex(80, 60, 2, 30);
    const rnd = random(8);
    // Full coverage, noisier, and speckle: a worst case for the number of regions.
    const { sweep } = synth({ field: (a, km) => (rnd() > 0.05 ? wind(a) + couplet(a, km) + (rnd() < 0.02 ? (rnd() - 0.5) * 40 : 0) : null), vn: 26, noise: 2 });
    dealiasSweep(sweep);
    const times: number[] = [];
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now();
      dealiasSweep(sweep);
      times.push(performance.now() - t0);
      console.log((globalThis as unknown as { T: string }).T);
    }
    times.sort((a, b) => a - b);
    // Well under 150 ms on a laptop; generous here for slow CI machines.
    expect(times[2]).toBeLessThan(400);
  });
});

describe("velocity dealiasing on a real volume", () => {
  it("reads Message 1's Nyquist velocity (KTLX 10 May 2005) and leaves its unfolded winds alone", async () => {
    const file = await gunzipIfNeeded(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "KTLX20050510_000351_cut12.gz"))));
    const sweep = parseLevel2(file, "VEL", 0.5, { site: { lat: 35.333, lon: -97.278 } }).sweep!;
    const vn = sweep.nyquist!;
    expect(vn.length).toBe(sweep.nRadials);
    // 28.19 m/s throughout the cut (PRF about 1050 Hz at 10.7 cm).
    expect(vn.every((v) => Math.abs(v / KT - 28.19) < 0.01)).toBe(true);
    expect(parseLevel2(file, "REF", 0.5, { site: { lat: 35.333, lon: -97.278 } }).sweep!.nyquist).toBeUndefined();

    // That evening's winds stayed inside its 28 m/s: nothing is folded, so nothing changes.
    expect(dealiasSweep(sweep)).toBe(sweep);
  });

  it("reads Message 31's Nyquist velocity (KTLX 19 Oct 2026) and only unfolds its odd gates out", () => {
    const sweep = parseLevel2(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "KTLX_cut1_V06"))), "VEL", 0.5).sweep!;
    const vn = 33.04 * KT;
    expect(sweep.nyquist!.every((v) => Math.abs(v - vn) < 0.02)).toBe(true);
    const out = dealiasSweep(sweep);
    let valid = 0;
    const moved: number[] = [];
    for (let i = 0; i < sweep.data.length; i++) {
      if (sweep.data[i]! < 2) continue;
      valid++;
      const d = out.table[out.data[i]!]! - sweep.table[sweep.data[i]!]!;
      if (Math.abs(d) > 1) moved.push(d / (2 * vn));
    }
    // A few lone −33 m/s gates among +15 to +25 near the radar become +33; nothing else moves.
    expect(moved.length).toBeLessThan(valid * 0.001);
    for (const folds of moved) expect(Math.abs(folds - Math.round(folds))).toBeLessThan(0.02);
  });

  it("puts back the same sweep folded again at a lower Nyquist velocity", async () => {
    const file = await gunzipIfNeeded(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "KTLX20050510_000351_cut12.gz"))));
    const sweep = parseLevel2(file, "VEL", 0.5, { site: { lat: 35.333, lon: -97.278 } }).sweep!;
    // Real noise, gaps and shear, folded at 12 m/s: about 3% of its gates fold.
    const vn = 12 * KT;
    const data = sweep.data.slice();
    for (let i = 0; i < data.length; i++) {
      if (data[i]! < 2) continue;
      const v = sweep.table[data[i]!]!;
      data[i] = Math.round(129 + ((v - 2 * vn * Math.round(v / (2 * vn))) / KT) * 2);
    }
    const out = dealiasSweep({ ...sweep, data, nyquist: new Float32Array(sweep.nRadials).fill(vn) });
    let n = 0, ok = 0, folded = 0, foldedOk = 0, broken = 0;
    for (let i = 0; i < data.length; i++) {
      if (sweep.data[i]! < 2) continue;
      const want = sweep.table[sweep.data[i]!]!;
      const good = Math.abs(out.table[out.data[i]!]! - want) < 1.5;
      n++;
      if (good) ok++;
      if (Math.abs(want) > vn) {
        folded++;
        if (good) foldedOk++;
      } else if (!good) broken++;
    }
    expect(folded / n).toBeGreaterThan(0.02);
    expect(ok / n).toBeGreaterThanOrEqual(0.98);
    // Most folded gates come back; what doesn't is mostly lone noisy gates, left as measured.
    expect(foldedOk / folded).toBeGreaterThan(0.7);
    // Gates that weren't folded are hardly ever unfolded by mistake.
    expect(broken / n).toBeLessThan(0.002);
  });
});
