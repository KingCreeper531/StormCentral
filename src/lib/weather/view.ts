/** Helpers for slicing a columnar forecast relative to "now". */
import type { Forecast } from "../api/open-meteo";
import { timePrefsVersion, withClock, zoneFor } from "../clock";

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
  // A day ends where the next one starts: DST change days are 23 or 25 hours long.
  for (let i = 0; i < d.length; i++) if ((d[i + 1] ?? d[i]! + 86400) > t) return i;
  return 0;
}

/**
 * Lowest low and highest high over the daily slots `idx`, skipping days with
 * no value (regional models return nulls past their range); null when none has one.
 */
export function dailyTempRange(f: Forecast, idx: readonly number[]): { min: number; max: number } | null {
  const temps = idx.flatMap((i) => [f.daily.tMin[i], f.daily.tMax[i]]).filter((v): v is number => v != null);
  return temps.length ? { min: Math.min(...temps), max: Math.max(...temps) } : null;
}

/**
 * A formatter in `tz` that follows the 12/24-hour and time zone settings (lib/clock).
 * `locale` is the display language's ("es-US": pass `t.locale`); the device's when omitted.
 */
export const fmtIn = (tz: string | undefined, opts: Intl.DateTimeFormatOptions, locale?: string) =>
  new Intl.DateTimeFormat(locale, withClock({ ...opts, timeZone: zoneFor(tz) }));

/**
 * A date formatter for the place's days (daily rows, "today" there). Daily
 * times are the place's local midnights, so they are read in its zone even
 * with "This device" chosen: in the device's zone, a place to the east would
 * show the day before.
 */
export function dayFmtIn(tz: string | undefined, opts: Intl.DateTimeFormatOptions, locale?: string) {
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz });
  } catch {
    return new Intl.DateTimeFormat(locale, opts); // unknown zone name: the device's
  }
}

/** Clock formatters by zone and locale (`""` = the device's); lists render many rows per tick. */
const clocks = new Map<string, Intl.DateTimeFormat>();
function clockFmt(tz: string | undefined, withZone: boolean, locale: string | undefined) {
  const key = `${tz ?? ""}|${withZone}|${locale ?? ""}|${timePrefsVersion()}`;
  let f = clocks.get(key);
  if (!f) {
    try {
      f = fmtIn(tz, { hour: "numeric", minute: "2-digit", ...(withZone && { timeZoneName: "short" }) }, locale);
    } catch {
      f = fmtIn(undefined, { hour: "numeric", minute: "2-digit" }, locale); // unknown zone name: device clock
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
 * `locale`: the display language's (`t.locale`, "5:45 p. m."); the device's when omitted.
 */
export function clockIn(zone: string | undefined, at: Date | number | string, locale?: string): string {
  const d = at instanceof Date ? at : new Date(at);
  const tz = zoneFor(zone);
  const there = clockFmt(tz, false, locale).format(d);
  if (!tz || clockFmt(undefined, false, locale).format(d) === there) return there;
  return clockFmt(tz, true, locale).format(d);
}
