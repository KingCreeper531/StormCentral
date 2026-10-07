/**
 * Time-axis ticks on round local hours, independent of the sample spacing.
 *
 * Index-based ticks drift with the data (every 13th of 3-hourly samples gives
 * "12 PM, 1 AM, 2 PM"), so ticks are chosen from wall-clock hours in the
 * chart's time zone instead and placed with the linear time scale.
 */

const HOUR = 3_600_000;
/** Candidate steps in hours; multi-day steps land on local midnights. */
const STEPS = [1, 2, 3, 6, 12, 24, 48, 72, 168] as const;
/** Safety cap on hourly candidates scanned (about 60 days). */
const MAX_SCAN = 1500;

export interface TimeTick {
  t: number;
  label: string;
}

interface LocalParts {
  dayIndex: number;
  hour: number;
  minute: number;
}

/**
 * @param maxTicks the most labels that fit (callers pass innerWidth / ~64 px)
 * @returns ticks on local hours that are multiples of the chosen step. On
 *   charts spanning more than a day, local midnight reads as the weekday
 *   ("12 PM · Thu · 12 PM · Fri") so the day boundary is visible.
 */
export function timeTicks(t0: number, t1: number, maxTicks: number, timeZone?: string): TimeTick[] {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return [];
  const spanH = (t1 - t0) / HOUR;
  const fit = Math.max(1, maxTicks);
  const step: number = STEPS.find((s) => spanH / s <= fit) ?? 168;

  const partsFmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const local = (t: number): LocalParts => {
    const p: Record<string, number> = {};
    for (const { type, value } of partsFmt.formatToParts(t)) if (type !== "literal") p[type] = Number(value);
    return { dayIndex: Math.round(Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1) / 86_400_000), hour: (p.hour ?? 0) % 24, minute: p.minute ?? 0 };
  };

  // First local top-of-hour at or after t0 (offsets can be :30 or :45).
  let start = t0 - (((t0 % 60_000) + 60_000) % 60_000) - local(t0).minute * 60_000;
  if (start < t0) start += HOUR;

  const multiDay = spanH > 24;
  const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone });
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone });
  const out: TimeTick[] = [];
  for (let t = start, n = 0; t <= t1 && n < MAX_SCAN; t += HOUR, n++) {
    const { dayIndex, hour, minute } = local(t);
    if (minute !== 0) continue;
    const keep = step < 24 ? hour % step === 0 : hour === 0 && dayIndex % (step / 24) === 0;
    if (!keep) continue;
    out.push({ t, label: multiDay && hour === 0 ? dayFmt.format(t) : hourFmt.format(t) });
  }
  return out;
}
