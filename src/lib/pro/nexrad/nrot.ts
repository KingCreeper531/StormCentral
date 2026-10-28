/**
 * Normalized rotation (NROT) from Level II velocity: azimuthal shear scaled
 * by how much shear counts as significant at that range, so one number reads
 * the same near the radar and far from it.
 *
 *  1. Median filter. Each gate takes the median of its 3 × 3 neighbourhood
 *     (3 radials × 3 gates, valid gates only); gates with no data stay empty
 *     (nothing is filled in). One noisy gate can't make a couplet.
 *  2. Azimuthal shear, by the linear least-squares derivative (LLSD) of
 *     Smith and Elmore (2004): over a patch around each gate (5 × 5 gates and
 *     radials, 9 × 9 for 0.5° super-resolution data) the velocity is fitted
 *     with a plane u ≈ a + b·s + c·d, s the distance across the beam (range ×
 *     angle off the centre radial) and d along it, by least squares over the
 *     valid gates. b is the azimuthal shear (s⁻¹), positive when velocity
 *     increases clockwise: cyclonic rotation in the northern hemisphere. The
 *     radial term keeps convergence or divergence in a lopsided patch out of
 *     it. Where the patch has gaps (under half its gates, or too few across
 *     the beam for a fit) the shear falls back to the nearest valid gate on
 *     each side at the same range: Δu / (range × Δangle).
 *  3. Normalisation. NROT = shear / T(r), with T(r) = T0 / (1 + r/R0),
 *     T0 = 0.0175 s⁻¹ and R0 = 40 km: 0.010 s⁻¹ at 30 km, 0.005 s⁻¹ at
 *     100 km, 0.0029 s⁻¹ at 200 km. The patch spans a fixed angle (about
 *     4.5–5°), so its width grows with range (2.4 km at 30 km, 7.9 km at
 *     100 km), and the beam broadens with it (about 1° wide): once they're
 *     wider than a vortex, its shear is spread over the patch and reads
 *     weaker roughly as 1/r. A mesocyclone 4 km across with 40 kt rotational
 *     velocity (20 m/s each way) reads about 1.0 at both 30 and 100 km on
 *     this curve. Near the radar T levels off at T0, where a patch only a few
 *     hundred metres wide would otherwise turn velocity noise into large
 *     shear. So NROT runs about −5 to +5: 1 is significant rotation (a
 *     moderate mesocyclone), 2.5 extreme (a tight, strong vortex, often a
 *     tornado), negative values anticyclonic.
 *
 * The curve is our own calibration from those vortex sizes (MRMS treats
 * low-level azimuthal shear above about 0.01 s⁻¹ as notable), not any
 * other program's. Gates without velocity have no NROT, and neither do
 * gates within 5 km of the radar: there the patch is only 100–200 m across,
 * so a 1 m/s wobble or ground clutter reads as extreme rotation.
 */
import { clockwise } from "./dealias";
import { encodeSweep, gateValues, type Grid } from "./polar";
import type { Sweep } from "./sweep";

const MS_PER_KT = 1 / 1.943844;
const DEG = Math.PI / 180;

export const SHEAR_T0 = 0.0175;
export const SHEAR_R0_KM = 40;
/** No NROT this close to the radar, km (see the top of this file). */
export const NROT_MIN_KM = 5;
/** The NROT the encoded sweep holds: ±8 in 0.01 steps (the colours stop at ±5). */
export const NROT_LIMIT = 8;

/** The azimuthal shear (s⁻¹) that counts as NROT 1 at `km` from the radar. */
export const shearThreshold = (km: number) => SHEAR_T0 / (1 + Math.max(0, km) / SHEAR_R0_KM);

/** Half the LLSD patch, in radials and gates: 9 × 9 for 0.5° super-resolution data, 5 × 5 otherwise. */
export const patchHalf = (g: Pick<Grid, "nRadials" | "azWidth">) => {
  const w = [...g.azWidth.slice(0, 32)].sort((a, b) => a - b)[Math.min(15, g.nRadials >> 1)] ?? 1;
  return w <= 0.75 ? 4 : 2;
};

const max3 = (a: number, b: number, c: number) => (a > b ? (a > c ? a : c) : b > c ? b : c);
const min3 = (a: number, b: number, c: number) => (a < b ? (a < c ? a : c) : b < c ? b : c);
const med3 = (a: number, b: number, c: number) => (a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b);

/** Each gate's median over 3 radials × 3 gates (valid gates only); empty gates stay NaN. */
export function median3x3(v: Float32Array, nRadials: number, nGates: number, prev: Int32Array, next: Int32Array): Float32Array {
  const G = nGates;
  const out = new Float32Array(v.length).fill(NaN);
  const near = new Float64Array(9);
  // Each gate's column of three (this radial and its neighbours), sorted, when all three have data.
  const lo = new Float64Array(G), mid = new Float64Array(G), hi = new Float64Array(G);
  const full = new Uint8Array(G);
  const rows = [0, 0, 0];
  for (let r = 0; r < nRadials; r++) {
    rows[0] = prev[r]! * G;
    rows[1] = r * G;
    rows[2] = next[r]! * G;
    const [pa, pb, pc] = rows as [number, number, number];
    for (let h = 0; h < G; h++) {
      const x = pa < 0 ? NaN : v[pa + h]!;
      const y = v[pb + h]!;
      const z = pc < 0 ? NaN : v[pc + h]!;
      if (x !== x || y !== y || z !== z) {
        full[h] = 0;
        continue;
      }
      full[h] = 1;
      const a = x < y ? x : y;
      const b = x < y ? y : x;
      lo[h] = a < z ? a : z;
      hi[h] = b > z ? b : z;
      mid[h] = z < a ? a : z > b ? b : z;
    }
    for (let g = 0; g < G; g++) {
      if (v[pb + g] !== v[pb + g]) continue;
      if (g > 0 && g + 1 < G && full[g - 1] && full[g] && full[g + 1]) {
        // Nine values from three sorted columns: the median of (largest low, middle middle, smallest high).
        const l = max3(lo[g - 1]!, lo[g]!, lo[g + 1]!);
        const h = min3(hi[g - 1]!, hi[g]!, hi[g + 1]!);
        out[pb + g] = med3(l, med3(mid[g - 1]!, mid[g]!, mid[g + 1]!), h);
        continue;
      }
      let m = 0;
      for (let k = 0; k < 3; k++) {
        const o = rows[k]!;
        if (o < 0) continue;
        for (let j = g > 0 ? g - 1 : 0, end = g + 1 < G ? g + 1 : G - 1; j <= end; j++) {
          const x = v[o + j]!;
          if (x !== x) continue;
          // Insertion sort as they come.
          let i = m++;
          while (i > 0 && near[i - 1]! > x) {
            near[i] = near[i - 1]!;
            i--;
          }
          near[i] = x;
        }
      }
      out[pb + g] = m & 1 ? near[m >> 1]! : (near[(m >> 1) - 1]! + near[m >> 1]!) / 2;
    }
  }
  return out;
}

/**
 * Azimuthal shear (s⁻¹, cyclonic positive) of velocities `u` (m/s) on a
 * sweep's grid by LLSD over a (2·half + 1)² patch, with the gate-pair
 * fallback where the patch has gaps (see the top of this file). NaN where a
 * gate has no velocity or no neighbour on either side.
 */
export function azimuthalShear(u: Float32Array, grid: Grid, half = patchHalf(grid)): Float32Array {
  const R = grid.nRadials;
  const G = grid.nGates;
  const K = half;
  const J = half;
  const { prev, next, centre } = clockwise(grid);
  const out = new Float32Array(R * G).fill(NaN);
  const dr = grid.gateKm;
  const rangeKm = new Float64Array(G);
  for (let g = 0; g < G; g++) rangeKm[g] = Math.max(grid.gateKm / 2, grid.firstGateKm + g * grid.gateKm);
  const full = (2 * K + 1) * (2 * J + 1);
  // Spread across the beam a full patch has, per gate and km² of range: Σ k² Δθ² / (2K + 1).
  const kVar = (K * (K + 1)) / 3;

  // Branch-free sums: 1/0 for data/none, and the velocity with 0 for none.
  const has = new Float32Array(R * G);
  const u0 = new Float32Array(R * G);
  for (let i = 0; i < u0.length; i++) {
    const x = u[i]!;
    if (x === x) {
      has[i] = 1;
      u0[i] = x;
    }
  }
  const S0 = new Float64Array(G), S1 = new Float64Array(G), S2 = new Float64Array(G), U0 = new Float64Array(G), U1 = new Float64Array(G);
  const P = Array.from({ length: 9 }, () => new Float64Array(G + 1));
  const [A0, A1, A2, B0, B1, C0, D0, D1, E0] = P as [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array, Float64Array, Float64Array, Float64Array, Float64Array];
  const nb = new Int32Array(2 * K + 1);
  const th = new Float64Array(2 * K + 1);

  for (let r = 0; r < R; r++) {
    const own = r * G;
    // The patch's radials, nearest first on each side (−1 past a gap), and their angles off this one (radians).
    nb.fill(-1);
    nb[K] = r;
    for (let k = 1, a = r, b = r; k <= K; k++) {
      a = a >= 0 ? prev[a]! : -1;
      b = b >= 0 ? next[b]! : -1;
      nb[K - k] = a;
      nb[K + k] = b;
    }
    for (let k = 0; k <= 2 * K; k++) {
      const q = nb[k]!;
      th[k] = q < 0 ? 0 : ((((centre[q]! - centre[r]! + 540) % 360) - 180) * DEG);
    }
    const width = grid.azWidth[r]! * DEG;
    S0.fill(0);
    S1.fill(0);
    S2.fill(0);
    U0.fill(0);
    U1.fill(0);
    let any = false;
    for (let g = 0; g < G && !any; g++) any = has[own + g] === 1;
    if (!any) continue;
    for (let k = 0; k <= 2 * K; k++) {
      const q = nb[k]!;
      if (q < 0) continue;
      const t = th[k]!;
      const t2 = t * t;
      for (let g = 0, o = q * G; g < G; g++) {
        const m = has[o + g]!;
        const x = u0[o + g]!;
        S0[g]! += m;
        S1[g]! += t * m;
        S2[g]! += t2 * m;
        U0[g]! += x;
        U1[g]! += t * x;
      }
    }
    // Running sums along the radial, so any window's moments are two reads.
    for (let g = 0; g < G; g++) {
      const ri = rangeKm[g]!;
      A0[g + 1] = A0[g]! + S0[g]!;
      A1[g + 1] = A1[g]! + g * S0[g]!;
      A2[g + 1] = A2[g]! + g * g * S0[g]!;
      B0[g + 1] = B0[g]! + ri * S1[g]!;
      B1[g + 1] = B1[g]! + ri * g * S1[g]!;
      C0[g + 1] = C0[g]! + ri * ri * S2[g]!;
      D0[g + 1] = D0[g]! + U0[g]!;
      D1[g + 1] = D1[g]! + g * U0[g]!;
      E0[g + 1] = E0[g]! + ri * U1[g]!;
    }
    for (let g = 0; g < G; g++) {
      if (!has[own + g]) continue;
      const lo = g > J ? g - J : 0;
      const hi = (g + J < G ? g + J : G - 1) + 1;
      const n = A0[hi]! - A0[lo]!;
      const ri = rangeKm[g]!;
      // Plane fit in km: s across the beam, d along it (offsets from this gate).
      const ss = B0[hi]! - B0[lo]!;
      const sss = C0[hi]! - C0[lo]!;
      const spread = sss - (ss * ss) / n;
      let shear = NaN;
      if (n >= full / 2 && spread >= 0.25 * n * kVar * (ri * width) ** 2) {
        const a1 = A1[hi]! - A1[lo]!;
        const sd = dr * (a1 - g * n);
        const sdd = dr * dr * (A2[hi]! - A2[lo]! - 2 * g * a1 + g * g * n);
        const ssd = dr * (B1[hi]! - B1[lo]! - g * ss);
        const su = D0[hi]! - D0[lo]!;
        const ssu = E0[hi]! - E0[lo]!;
        const sdu = dr * (D1[hi]! - D1[lo]! - g * su);
        // Cramer's rule for b in [n ss sd; ss sss ssd; sd ssd sdd]·[a b c] = [su ssu sdu].
        const det = n * (sss * sdd - ssd * ssd) - ss * (ss * sdd - ssd * sd) + sd * (ss * ssd - sss * sd);
        if (Math.abs(det) > 1e-9 * n * sss * Math.max(sdd, 1e-9)) {
          const db = n * (ssu * sdd - ssd * sdu) - su * (ss * sdd - ssd * sd) + sd * (ss * sdu - ssu * sd);
          // (m/s)/km → s⁻¹.
          shear = db / det / 1000;
        }
      }
      if (shear !== shear) {
        // Gate pair: the nearest valid gate either side.
        let left = -1;
        let right = -1;
        for (let k = 1; k <= K && (left < 0 || right < 0); k++) {
          const a = nb[K - k]!;
          const b = nb[K + k]!;
          if (left < 0 && a >= 0 && has[a * G + g]) left = K - k;
          if (right < 0 && b >= 0 && has[b * G + g]) right = K + k;
        }
        if (left >= 0 && right >= 0) {
          const du = u[nb[right]! * G + g]! - u[nb[left]! * G + g]!;
          shear = du / (ri * (th[right]! - th[left]!)) / 1000;
        }
      }
      out[own + g] = shear;
    }
  }
  return out;
}

/** NROT per gate of a velocity sweep (knots), on its own grid (see the top of this file). */
export function nrotField(vel: Sweep): Float32Array {
  const { prev, next } = clockwise(vel);
  const u = median3x3(gateValues(vel, MS_PER_KT), vel.nRadials, vel.nGates, prev, next);
  const shear = azimuthalShear(u, vel);
  const G = vel.nGates;
  const inv = new Float64Array(G);
  for (let g = 0; g < G; g++) {
    const km = (vel.firstGateKm + g * vel.gateKm) * Math.cos(vel.elevation * DEG);
    inv[g] = km < NROT_MIN_KM ? NaN : 1 / shearThreshold(km);
  }
  for (let i = 0; i < shear.length; i++) shear[i]! *= inv[i % G]!;
  return shear;
}

/** NROT values as a sweep on `grid` (±NROT_LIMIT in 0.01 steps). */
export const nrotSweep = (grid: Grid, nrot: Float32Array): Sweep => encodeSweep(grid, nrot, -NROT_LIMIT, NROT_LIMIT, 0.01);
