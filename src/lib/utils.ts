import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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
