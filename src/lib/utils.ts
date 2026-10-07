import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Inverse lerp, clamped to [0, 1]. */
export const unlerp = (a: number, b: number, v: number) => (a === b ? 0 : clamp((v - a) / (b - a), 0, 1));

export const round = (v: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Mean of the finite values in `values`; NaN when there are none. */
export function mean(values: ReadonlyArray<number | null | undefined>): number {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (isFiniteNumber(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : Number.NaN;
}

/** Index of the entry in a sorted epoch-seconds array closest to `t`. */
export function nearestIndex(times: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((times[lo - 1] as number) - t) <= Math.abs((times[lo] as number) - t)) return lo - 1;
  return lo;
}
