/** Helpers for slicing a columnar forecast relative to "now". */
import type { Forecast } from "../api/open-meteo";

/** Index of the hourly slot containing `nowMs` (hourly.time is epoch seconds). */
export function currentHourIndex(f: Forecast, nowMs: number): number {
  const t = nowMs / 1000;
  const times = f.hourly.time;
  let i = 0;
  while (i + 1 < times.length && times[i + 1]! <= t) i++;
  return i;
}

export function hourRange(f: Forecast, nowMs: number, count: number) {
  const start = currentHourIndex(f, nowMs);
  const end = Math.min(f.hourly.time.length, start + count);
  return { start, end, idx: Array.from({ length: end - start }, (_, k) => start + k) };
}

export function pick<T>(arr: readonly T[], idx: readonly number[]): T[] {
  return idx.map((i) => arr[i]!);
}

export function msTimes(f: Forecast, idx: readonly number[]) {
  return idx.map((i) => f.hourly.time[i]! * 1000);
}

/** Today's daily index (first daily slot whose date is ≥ local today). */
export function todayIndex(f: Forecast, nowMs: number) {
  const t = nowMs / 1000;
  const d = f.daily.time;
  for (let i = 0; i < d.length; i++) if (d[i]! + 86400 > t) return i;
  return 0;
}

export const fmtIn = (tz: string | undefined, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz });
