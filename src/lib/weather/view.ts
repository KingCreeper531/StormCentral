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

/** Clock formatters by zone (`""` = the device's); lists render many rows per tick. */
const clocks = new Map<string, Intl.DateTimeFormat>();
function clockFmt(tz: string | undefined, withZone: boolean) {
  const key = `${tz ?? ""}|${withZone}`;
  let f = clocks.get(key);
  if (!f) {
    try {
      f = fmtIn(tz, { hour: "numeric", minute: "2-digit", ...(withZone && { timeZoneName: "short" }) });
    } catch {
      f = fmtIn(undefined, { hour: "numeric", minute: "2-digit" }); // unknown zone name: device clock
    }
    clocks.set(key, f);
  }
  return f;
}

/**
 * Clock time ("5:45 PM") in the selected location's zone, so it agrees with
 * the forecast and every other time on screen. When that zone's clock reads
 * differently from the device's at that instant (viewing a place elsewhere),
 * the zone is named ("5:45 PM CDT"), so the time can't be misread.
 */
export function clockIn(tz: string | undefined, at: Date | number | string): string {
  const d = at instanceof Date ? at : new Date(at);
  const there = clockFmt(tz, false).format(d);
  if (!tz || clockFmt(undefined, false).format(d) === there) return there;
  return clockFmt(tz, true).format(d);
}
