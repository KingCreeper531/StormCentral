/**
 * Velocity dealiasing for Level II sweeps. A Doppler radar measures radial
 * velocity only modulo twice the Nyquist velocity Vn: a gate moving at v
 * shows as v − 2nVn for whichever whole n brings it inside ±Vn, so a strong
 * inbound wind can show as a band of outbound colour. This puts the folds
 * back, in the decode worker, before the sweep is coloured:
 *
 *  1. Regions. Neighbouring gates (along the radial, and across to the next
 *     radial by azimuth, through 0°/360°) whose raw values differ by under
 *     0.4 Vn are joined, so each region is one fold throughout.
 *  2. Region folds. From a seed per connected area (its largest region with a
 *     mean near zero), each region gets the fold that best matches the
 *     regions already done along their shared boundary, longest boundaries
 *     first. A region whose best match is still poor (over 0.7 Vn off on
 *     average) is ambiguous and keeps its raw values.
 *  3. Anchoring. A VAD-style fit (a + b cos az + c sin az) per range band
 *     gives the environmental wind; its constant term is near zero for real
 *     winds, so an area whose fit has |a| over Vn is a whole fold off and is
 *     shifted. Areas too small or too one-sided for a fit of their own are
 *     compared with the fit of the rest.
 *  4. Streaks. A gate over Vn from the median of its neighbourhood (3 radials
 *     × 5 gates) is unfolded towards it, when a whole fold brings it within
 *     0.5 Vn.
 *
 * Missing and range-folded gates stay as they are and only break continuity;
 * each radial unfolds with its own Nyquist velocity. Nothing is filled in or
 * smoothed: every gate keeps its measured value plus a whole number of folds.
 * The result is re-encoded on the sweep's own value scale, on 16-bit levels
 * when the unfolded values reach past the 8-bit ones. A noisy super-res sweep
 * takes about 70 ms at 720 × 1200 gates, 110 ms at the full 720 × 1832, on
 * one core of a busy test machine (dealias.test.ts).
 */
import type { Sweep } from "./sweep";

/** Neighbours closer than this (× Vn) are one region. */
const JOIN = 0.4;
/** A region's fold is only taken when its boundary then matches within this (× Vn) on average. */
const AMBIGUOUS = 0.7;
const MAX_FOLDS = 4;
const BAND_KM = 20;
/** Azimuth bins for the VAD fit, and how many of each quadrant's must have data. */
const AZ_BINS = 36;
const MIN_QUADRANT_BINS = 5;
const MIN_BIN_GATES = 4;
/** Areas with fewer gates aren't fitted on their own; under MIN_CHECK_GATES they aren't compared either. */
const MIN_FIT_GATES = 2000;
const MIN_CHECK_GATES = 10;
/** The fits and checks read every third gate along the radial: plenty for a mean wind. */
const STRIDE = 3;
const STREAK_PASSES = 3;
const DEG = Math.PI / 180;

/**
 * Each radial's neighbour clockwise (-1 across a gap), from the radials'
 * centre azimuths: radials can start anywhere and wrap through north, and a
 * sweep still being scanned has a gap.
 */
function clockwise(s: Pick<Sweep, "nRadials" | "azStart" | "azWidth">): { next: Int32Array; prev: Int32Array; centre: Float64Array } {
  const n = s.nRadials;
  const centre = new Float64Array(n);
  for (let r = 0; r < n; r++) centre[r] = (s.azStart[r]! + s.azWidth[r]! / 2) % 360;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => centre[a]! - centre[b]!);
  const next = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  for (let k = 0; n > 1 && k < n; k++) {
    const a = order[k]!;
    const b = order[(k + 1) % n]!;
    const gap = (centre[b]! - centre[a]! + 360) % 360;
    if (gap <= 1.5 * Math.max(s.azWidth[a]!, s.azWidth[b]!)) {
      next[a] = b;
      prev[b] = a;
    }
  }
  return { next, prev, centre };
}

/** A max-heap of (region, boundary length) for the region pass. Stale entries are skipped when popped. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! >= key) break;
      ids[i] = ids[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  /** The top entry's id and key; call only when not empty. */
  pop(): [number, number] {
    const { ids, keys } = this;
    const top: [number, number] = [ids[0]!, keys[0]!];
    const id = ids.pop()!;
    const key = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && keys[l + 1]! > keys[l]! ? l + 1 : l;
        if (keys[c]! <= key) break;
        ids[i] = ids[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

/** Least-squares a + b cos θ + c sin θ through azimuth bins' means; null without data all round. */
function vadFit(sum: Float64Array, count: Float64Array, at: number): { a: number; b: number; c: number } | null {
  const quadrants = [0, 0, 0, 0];
  // Normal equations for [1, cos, sin].
  let n = 0, sc = 0, ss = 0, scc = 0, sss = 0, scs = 0, y = 0, yc = 0, ys = 0;
  for (let k = 0; k < AZ_BINS; k++) {
    const m = count[at + k]!;
    if (m < MIN_BIN_GATES) continue;
    quadrants[Math.floor((k * 4) / AZ_BINS)]!++;
    const th = ((k + 0.5) * 2 * Math.PI) / AZ_BINS;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const v = sum[at + k]! / m;
    n++;
    sc += c;
    ss += s;
    scc += c * c;
    sss += s * s;
    scs += c * s;
    y += v;
    yc += v * c;
    ys += v * s;
  }
  if (quadrants.some((q) => q < MIN_QUADRANT_BINS)) return null;
  // Cramer's rule on the 3×3 system.
  const det3 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const D = det3(n, sc, ss, sc, scc, scs, ss, scs, sss);
  if (Math.abs(D) < 1e-9) return null;
  return {
    a: det3(y, sc, ss, yc, scc, scs, ys, scs, sss) / D,
    b: det3(n, y, ss, sc, yc, scs, ss, ys, sss) / D,
    c: det3(n, sc, y, sc, scc, yc, ss, scs, ys) / D,
  };
}

/**
 * Each gate's fold count n (the unfolded value is v + 2n·Vn), or null when
 * the sweep doesn't carry Nyquist velocities (Level III, other moments).
 */
export function velocityFolds(s: Sweep): Int8Array | null {
  const { nRadials: R, nGates: G, nyquist } = s;
  if (!nyquist || nyquist.length !== R || !R || !G) return null;
  const N = R * G;
  const { next, prev, centre } = clockwise(s);

  // Values (NaN: no data, range folded, or a radial without a Nyquist velocity).
  const lut = Float32Array.from(s.table);
  for (const sp of s.special) if (sp.level < lut.length) lut[sp.level] = NaN;
  const v = new Float32Array(N);
  for (let r = 0; r < R; r++) {
    const ok = nyquist[r]! > 0;
    for (let i = r * G, end = i + G; i < end; i++) v[i] = ok ? lut[s.data[i]!]! : NaN;
  }

  // ── 1. Regions: runs of gates along each radial, then runs joined across radials (union-find) ──
  const run = new Int32Array(N).fill(-1);
  let nRun = 0;
  for (let r = 0; r < R; r++) {
    const t = JOIN * nyquist[r]!;
    let cur = -1;
    for (let g = 0, i = r * G; g < G; g++, i++) {
      const vi = v[i]!;
      if (vi !== vi) cur = -1;
      else {
        if (cur < 0 || !(Math.abs(vi - v[i - 1]!) < t)) cur = nRun++;
        run[i] = cur;
      }
    }
  }
  const parent = new Int32Array(nRun);
  for (let k = 0; k < nRun; k++) parent[k] = k;
  const find = (k: number) => {
    while (parent[k] !== k) {
      const p = parent[parent[k]!]!;
      parent[k] = p;
      k = p;
    }
    return k;
  };
  for (let r = 0; r < R; r++) {
    const vn = nyquist[r]!;
    const q = next[r]!;
    // Across radials only where both unfold alike (the same Nyquist velocity).
    if (q < 0 || !(Math.abs(nyquist[q]! - vn) < 0.02 * vn)) continue;
    const t = JOIN * vn;
    let lastA = -1;
    let lastB = -1;
    for (let g = 0, i = r * G, j = q * G; g < G; g++, i++, j++) {
      const a = run[i]!;
      const b = run[j]!;
      if (a < 0 || b < 0 || (a === lastA && b === lastB) || !(Math.abs(v[i]! - v[j]!) < t)) continue;
      // Once two runs are joined, the rest of their side-by-side gates have nothing to add.
      lastA = a;
      lastB = b;
      const x = find(a);
      const y = find(b);
      if (x < y) parent[y] = x;
      else if (y < x) parent[x] = y;
    }
  }
  // Regions numbered 0..nReg-1 by their root run.
  const idOf = new Int32Array(nRun).fill(-1);
  let nReg = 0;
  for (let k = 0; k < nRun; k++) if (find(k) === k) idOf[k] = nReg++;
  for (let k = 0; k < nRun; k++) idOf[k] = idOf[find(k)]!;
  // Each gate's region, in place of its run.
  const region = run;
  const regSum = new Float64Array(nReg);
  const regVn = new Float64Array(nReg);
  const regSize = new Int32Array(nReg);
  for (let r = 0, i = 0; r < R; r++) {
    const vn = nyquist[r]!;
    for (let g = 0; g < G; g++, i++) {
      const k = run[i]!;
      const id = k < 0 ? -1 : idOf[k]!;
      region[i] = id;
      if (id < 0) continue;
      regSum[id]! += v[i]!;
      regVn[id]! += vn;
      regSize[id]!++;
    }
  }

  // ── Region boundaries: per pair, the gate pairs' count and sums of each side's value and Nyquist ──
  const edgeOf = new Map<number, number>();
  const eA: number[] = [], eB: number[] = [], eC: number[] = [], eSA: number[] = [], eSB: number[] = [], eNA: number[] = [], eNB: number[] = [];
  let lastKey = -1;
  let lastEdge = -1;
  const pair = (i: number, j: number, vnI: number, vnJ: number) => {
    const ri = region[i]!;
    const rj = region[j]!;
    if (ri < 0 || rj < 0 || ri === rj) return;
    // Stored lower region first.
    const flip = ri > rj;
    const a = flip ? rj : ri;
    const b = flip ? ri : rj;
    const key = a * nReg + b;
    let e = key === lastKey ? lastEdge : edgeOf.get(key);
    if (e === undefined) {
      e = eA.length;
      edgeOf.set(key, e);
      eA.push(a);
      eB.push(b);
      eC.push(0);
      eSA.push(0);
      eSB.push(0);
      eNA.push(0);
      eNB.push(0);
    }
    lastKey = key;
    lastEdge = e;
    eC[e]!++;
    eSA[e]! += flip ? v[j]! : v[i]!;
    eSB[e]! += flip ? v[i]! : v[j]!;
    eNA[e]! += flip ? vnJ : vnI;
    eNB[e]! += flip ? vnI : vnJ;
  };
  for (let r = 0; r < R; r++) {
    const vn = nyquist[r]!;
    const q = next[r]!;
    const vq = q >= 0 ? nyquist[q]! : 0;
    for (let g = 0, i = r * G, j = q * G; g < G; g++, i++, j++) {
      const id = region[i]!;
      if (id < 0) continue;
      if (g + 1 < G && region[i + 1] !== id) pair(i, i + 1, vn, vn);
      if (q >= 0 && region[j] !== id) pair(i, j, vn, vq);
    }
  }
  const nEdge = eA.length;
  // Adjacency (CSR).
  const degree = new Int32Array(nReg + 1);
  for (let e = 0; e < nEdge; e++) {
    degree[eA[e]! + 1]!++;
    degree[eB[e]! + 1]!++;
  }
  for (let k = 0; k < nReg; k++) degree[k + 1]! += degree[k]!;
  const adj = new Int32Array(2 * nEdge);
  const fill = degree.slice(0, nReg);
  for (let e = 0; e < nEdge; e++) {
    adj[fill[eA[e]!]!++] = e;
    adj[fill[eB[e]!]!++] = e;
  }

  // ── 2. Region folds, area by area ──
  const comp = new Int32Array(nReg).fill(-1);
  const fold = new Int8Array(nReg);
  const done = new Uint8Array(nReg);
  const accS = new Float64Array(nReg);
  const accW = new Float64Array(nReg);
  const accC = new Float64Array(nReg);
  const heap = new Heap();
  /** Region `b` now has fold n: its unfinished neighbours learn what their side of the boundary should match. */
  const relax = (b: number, n: number) => {
    for (let k = degree[b]!; k < degree[b + 1]!; k++) {
      const e = adj[k]!;
      const own = eA[e] === b;
      const x = own ? eB[e]! : eA[e]!;
      if (done[x]) continue;
      // Σ(x's raw value − b's unfolded value) and Σ x's Nyquist: x's fold m leaves a mean mismatch of (S + 2m·W) / C.
      accS[x]! += own ? eSB[e]! - eSA[e]! - 2 * n * eNA[e]! : eSA[e]! - eSB[e]! - 2 * n * eNB[e]!;
      accW[x]! += own ? eNB[e]! : eNA[e]!;
      accC[x]! += eC[e]!;
      heap.push(x, accC[x]!);
    }
  };
  let nComp = 0;
  const stack: number[] = [];
  for (let start = 0; start < nReg; start++) {
    if (comp[start]! >= 0) continue;
    // The area's regions, and its seed: the largest whose mean is within Vn/2 of zero (else the largest).
    const c = nComp++;
    comp[start] = c;
    stack.push(start);
    let seed = start, seedNear = -1, nearSize = -1;
    while (stack.length) {
      const x = stack.pop()!;
      if (regSize[x]! > regSize[seed]!) seed = x;
      if (Math.abs(regSum[x]!) < 0.5 * regVn[x]! && regSize[x]! > nearSize) [seedNear, nearSize] = [x, regSize[x]!];
      for (let k = degree[x]!; k < degree[x + 1]!; k++) {
        const e = adj[k]!;
        const y = eA[e] === x ? eB[e]! : eA[e]!;
        if (comp[y]! < 0) {
          comp[y] = c;
          stack.push(y);
        }
      }
    }
    if (seedNear >= 0) seed = seedNear;
    done[seed] = 1;
    relax(seed, 0);
    while (heap.size) {
      const [x, key] = heap.pop();
      if (done[x] || key !== accC[x]) continue;
      const n = Math.round(-accS[x]! / (2 * accW[x]!));
      const miss = Math.abs(accS[x]! + 2 * n * accW[x]!) / accC[x]!;
      // Ambiguous: keep its raw values (it may still be settled by a later neighbour).
      if (miss > AMBIGUOUS * (accW[x]! / accC[x]!) || Math.abs(n) > MAX_FOLDS) continue;
      fold[x] = n;
      done[x] = 1;
      relax(x, n);
    }
  }

  // ── 3. Anchoring to the environmental wind ──
  const folds = new Int8Array(N);
  const u = new Float32Array(N);
  /** The area of each region whose fold is settled (-1: ambiguous). */
  const settled = new Int32Array(nReg);
  for (let id = 0; id < nReg; id++) settled[id] = done[id] ? comp[id]! : -1;
  const areaOf = (i: number) => {
    const id = region[i]!;
    return id < 0 ? -1 : settled[id]!;
  };
  const compGates = new Float64Array(nComp);
  const compVn = new Float64Array(nComp);
  for (let r = 0, i = 0; r < R; r++) {
    const vn = nyquist[r]!;
    for (let g = 0; g < G; g++, i++) {
      const id = region[i]!;
      if (id >= 0 && done[id]) {
        const c = comp[id]!;
        folds[i] = fold[id]!;
        compGates[c]!++;
        compVn[c]! += vn;
      }
      u[i] = v[i]! + 2 * folds[i]! * vn;
    }
  }
  const unfold = () => {
    for (let r = 0, i = 0; r < R; r++) for (let g = 0, w = 2 * nyquist[r]!; g < G; g++, i++) u[i] = v[i]! + folds[i]! * w;
  };
  const nBands = Math.ceil((s.firstGateKm + G * s.gateKm) / BAND_KM);
  const band = new Int32Array(G);
  for (let g = 0; g < G; g++) {
    const km = s.firstGateKm + g * s.gateKm;
    band[g] = km < 5 ? -1 : Math.floor(km / BAND_KM);
  }
  const bin = new Int32Array(R);
  for (let r = 0; r < R; r++) bin[r] = Math.floor((centre[r]! / 360) * AZ_BINS) % AZ_BINS;
  /** u is out of date. */
  let stale = false;
  const shift = (c: number, k: number) => {
    for (let i = 0; i < N; i++) if (areaOf(i) === c) folds[i]! += k;
    stale = true;
  };
  // Areas big enough to fit on their own.
  const big = new Int32Array(nComp).fill(-1);
  let nBig = 0;
  for (let c = 0; c < nComp; c++) if (compGates[c]! >= MIN_FIT_GATES) big[c] = nBig++;
  const cell = nBands * AZ_BINS;
  const sum = new Float64Array(Math.max(1, nBig) * cell);
  const cnt = new Float64Array(sum.length);
  for (let r = 0; r < R; r++) {
    for (let g = 0, i = r * G; g < G; g += STRIDE, i += STRIDE) {
      const c = areaOf(i);
      const b = band[g]!;
      if (c < 0 || b < 0 || big[c]! < 0) continue;
      const at = big[c]! * cell + b * AZ_BINS + bin[r]!;
      sum[at]! += u[i]!;
      cnt[at]!++;
    }
  }
  const anchored = new Uint8Array(nComp);
  for (let c = 0; c < nComp; c++) {
    if (big[c]! < 0) continue;
    const terms: number[] = [];
    for (let b = 0; b < nBands; b++) {
      const fit = vadFit(sum, cnt, big[c]! * cell + b * AZ_BINS);
      if (fit) terms.push(fit.a);
    }
    if (!terms.length) continue;
    anchored[c] = 1;
    terms.sort((x, y) => x - y);
    const a = terms[terms.length >> 1]!;
    const k = Math.round(-a / ((2 * compVn[c]!) / compGates[c]!));
    if (k) shift(c, k);
  }
  // The anchored areas' fit (shifted as above) checks the rest, band by band.
  if (anchored.some((x) => !x) && anchored.some((x) => x)) {
    if (stale) unfold();
    stale = false;
    const all = new Float64Array(cell);
    const allN = new Float64Array(cell);
    for (let r = 0; r < R; r++) {
      for (let g = 0, i = r * G; g < G; g += STRIDE, i += STRIDE) {
        const c = areaOf(i);
        const b = band[g]!;
        if (c < 0 || b < 0 || !anchored[c]) continue;
        const at = b * AZ_BINS + bin[r]!;
        all[at]! += u[i]!;
        allN[at]!++;
      }
    }
    const fits = Array.from({ length: nBands }, (_, b) => vadFit(all, allN, b * AZ_BINS));
    const res = new Float64Array(nComp);
    const resN = new Float64Array(nComp);
    const resVn = new Float64Array(nComp);
    for (let r = 0; r < R; r++) {
      const cos = Math.cos(centre[r]! * DEG);
      const sin = Math.sin(centre[r]! * DEG);
      for (let g = 0, i = r * G; g < G; g += STRIDE, i += STRIDE) {
        const c = areaOf(i);
        const b = band[g]!;
        const fit = b >= 0 ? fits[b] : null;
        if (c < 0 || anchored[c] || !fit) continue;
        res[c]! += u[i]! - (fit.a + fit.b * cos + fit.c * sin);
        resN[c]!++;
        resVn[c]! += nyquist[r]!;
      }
    }
    for (let c = 0; c < nComp; c++) {
      if (resN[c]! < MIN_CHECK_GATES) continue;
      const off = res[c]! / resN[c]!;
      const vn = resVn[c]! / resN[c]!;
      const k = Math.round(-off / (2 * vn));
      if (k && Math.abs(off + 2 * k * vn) < 0.5 * vn) shift(c, k);
    }
  }

  // ── 4. Streaks: gates at odds with their neighbourhood's median ──
  if (stale) unfold();
  const near = new Float64Array(14);
  /** The pass a gate is next worth settling in (its neighbourhood changed in the one before). */
  const recheck = new Uint8Array(N);
  let pass = 0;
  /** Unfold gate i (radial r, gate g) to its neighbourhood's median if a whole fold clearly gets it there. */
  const settle = (i: number, r: number, g: number): boolean => {
    const vn = nyquist[r]!;
    const ui = u[i]!;
    let m = 0;
    for (let row = 0; row < 3; row++) {
      const q = row === 0 ? prev[r]! : row === 1 ? r : next[r]!;
      if (q < 0) continue;
      for (let h = Math.max(0, g - 2), o = q * G; h <= Math.min(G - 1, g + 2); h++) {
        if (row === 1 && h === g) continue;
        const x = u[o + h]!;
        if (x !== x) continue;
        // Insertion sort as they come.
        let k = m++;
        while (k > 0 && near[k - 1]! > x) {
          near[k] = near[k - 1]!;
          k--;
        }
        near[k] = x;
      }
    }
    if (m < 5) return false;
    const d = (m & 1 ? near[m >> 1]! : (near[(m >> 1) - 1]! + near[m >> 1]!) / 2) - ui;
    if (Math.abs(d) <= vn) return false;
    const k = Math.round(d / (2 * vn));
    const f = folds[i]! + k;
    if (!k || Math.abs(d - 2 * k * vn) >= 0.5 * vn || Math.abs(f) > MAX_FOLDS) return false;
    folds[i] = f;
    u[i] = ui + 2 * k * vn;
    // Its neighbourhood is worth another look next pass.
    for (let row = 0; row < 3; row++) {
      const q = row === 0 ? prev[r]! : row === 1 ? r : next[r]!;
      if (q >= 0) for (let h = Math.max(0, g - 2), o = q * G; h <= Math.min(G - 1, g + 2); h++) recheck[o + h] = pass + 1;
    }
    return true;
  };
  // Candidates: gates that a neighbour disagrees with by more than Vn. Later passes only revisit those near a change.
  const odd: number[] = [];
  let changed = 0;
  for (let r = 0; r < R; r++) {
    const vn = nyquist[r]!;
    const p = prev[r]! * G;
    const q = next[r]! * G;
    for (let g = 0, i = r * G; g < G; g++, i++) {
      const ui = u[i]!;
      if (ui !== ui) continue;
      if (
        (g > 0 && Math.abs(u[i - 1]! - ui) > vn) ||
        (g + 1 < G && Math.abs(u[i + 1]! - ui) > vn) ||
        (p >= 0 && Math.abs(u[p + g]! - ui) > vn) ||
        (q >= 0 && Math.abs(u[q + g]! - ui) > vn)
      ) {
        odd.push(i);
        if (settle(i, r, g)) changed++;
      }
    }
  }
  for (pass = 1; pass < STREAK_PASSES && changed; pass++) {
    changed = 0;
    for (const i of odd) if (recheck[i] === pass && settle(i, (i / G) | 0, i % G)) changed++;
  }
  return folds;
}

/**
 * The sweep with its velocities unfolded (see the top of this file). Sweeps
 * without Nyquist velocities, or with nothing folded, come back as they are.
 */
export function dealiasSweep(s: Sweep): Sweep {
  const folds = velocityFolds(s);
  const { table, nyquist, nRadials: R, nGates: G } = s;
  // The value scale is linear from level 2 (Level II's: 0 below threshold, 1 range folded).
  const step = table[3]! - table[2]!;
  if (!folds || !nyquist || !(step > 0)) return s;
  // Levels after unfolding: 2nVn in level steps (rounded: under half a step off, finer than the data).
  const per = Float64Array.from(nyquist, (vn) => (2 * vn) / step);
  let any = false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0, i = 0; r < R; r++) {
    for (let g = 0; g < G; g++, i++) {
      const raw = s.data[i]!;
      if (raw < 2) continue;
      const f = folds[i]!;
      const l = f ? raw + Math.round(f * per[r]!) : raw;
      if (f) any = true;
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
  }
  if (!any) return s;
  const fits = lo >= 2 && hi < table.length;
  // Past the original levels: 16-bit levels, moved up so the lowest is 2, on the same scale extended.
  const up = fits ? 0 : 2 - Math.min(2, lo);
  if (hi + up > 65535) return s;
  const data = fits ? new (s.data.constructor as typeof Uint8Array | typeof Uint16Array)(R * G) : new Uint16Array(R * G);
  for (let r = 0, i = 0; r < R; r++) {
    for (let g = 0; g < G; g++, i++) {
      const raw = s.data[i]!;
      const f = folds[i]!;
      data[i] = raw < 2 ? raw : (f ? raw + Math.round(f * per[r]!) : raw) + up;
    }
  }
  let out = table;
  if (!fits) {
    out = new Float32Array(Math.max(table.length, hi + up + 1)).fill(NaN);
    for (let l = 2; l < out.length; l++) out[l] = table[2]! + (l - up - 2) * step;
  }
  return { ...s, data, table: out };
}
