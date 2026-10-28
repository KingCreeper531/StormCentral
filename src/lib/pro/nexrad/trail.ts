/**
 * Max value trails: a running per-gate maximum over the volumes of a loop,
 * so a rotation or a hail core leaves a track behind it. Volume k shows the
 * maximum of volumes 1…k. Signed products (velocity, storm-relative
 * velocity, NROT) keep the value of largest magnitude, with its sign, so
 * inbound and anticyclonic extremes stay visible too.
 *
 * Every volume is looked up on the first one's gates (radials start at
 * different azimuths from one scan to the next), and the result is encoded
 * on the product's own value step. A trail starts over when what it follows
 * (site, product, tilt) changes.
 */
import { encodeSweep, gateValues, resample, type Grid } from "./polar";
import type { Sweep } from "./sweep";

/** Keep `b` over `a`: the larger, or (signed) the larger in magnitude. NaN is no data. */
export const keepMax = (a: number, b: number, signed: boolean) => (a !== a ? b : b !== b ? a : signed ? (Math.abs(b) > Math.abs(a) ? b : a) : b > a ? b : a);

export class MaxTrail {
  private key: string | null = null;
  private grid: Grid | null = null;
  private acc: Float32Array | null = null;
  private step = 1;

  constructor(readonly signed: boolean) {}

  /** Start over. */
  reset() {
    this.key = null;
    this.grid = null;
    this.acc = null;
  }

  /** How many gates the trail holds (0 when reset). */
  get size() {
    return this.acc?.length ?? 0;
  }

  /**
   * Add a volume's sweep; returns the trail so far as a sweep. A different
   * `key` (site, product, tilt) than the last one starts a new trail.
   */
  add(key: string, sweep: Sweep): Sweep {
    if (key !== this.key) this.reset();
    this.key = key;
    const v = gateValues(sweep);
    if (!this.grid || !this.acc) {
      this.grid = sweep;
      this.acc = v;
      this.step = sweep.table[3]! - sweep.table[2]! || 1;
    } else {
      const on = resample(v, sweep, this.grid);
      const acc = this.acc;
      for (let i = 0; i < acc.length; i++) acc[i] = keepMax(acc[i]!, on[i]!, this.signed);
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of this.acc) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (!(lo <= hi)) lo = hi = 0;
    const step = this.step;
    return encodeSweep({ ...this.grid, time: sweep.time }, this.acc, Math.floor(lo / step) * step, hi, step);
  }
}

/** Each volume's trail so far, oldest first (see the top of this file). */
export function maxTrails(key: string, sweeps: readonly Sweep[], signed: boolean): Sweep[] {
  const trail = new MaxTrail(signed);
  return sweeps.map((s) => trail.add(key, s));
}
