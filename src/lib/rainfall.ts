import type { RecentPrecip } from "./api/open-meteo";

export interface RainTotals {
  lastHour: number | null;
  /** Since local midnight. */
  today: number | null;
  last24h: number | null;
  last72h: number | null;
  last7d: number | null;
  last30d: number | null;
  /** From the 1st of this month to now. */
  monthToDate: number | null;
  next24h: number | null;
  next72h: number | null;
  /** Days since the last day with at least 1 mm: 0 today, 1 yesterday (null: none in the record). */
  dryDays: number | null;
}

const HOUR = 3_600_000;

/** Sum of hourly totals whose hour ends in (from, to]; null when no hour in range has data. */
function sumHours(r: RecentPrecip, fromMs: number, toMs: number): number | null {
  let total = 0;
  let any = false;
  const { time, precip } = r.hourly;
  for (let i = 0; i < time.length; i++) {
    const t = time[i]! * 1000;
    if (t <= fromMs || t > toMs) continue;
    const v = precip[i];
    if (v == null) continue;
    total += v;
    any = true;
  }
  return any ? total : null;
}

/** Index of the day containing `nowMs` (days start at local midnight). */
function dayIndex(r: RecentPrecip, nowMs: number): number {
  const t = r.daily.time;
  let idx = -1;
  for (let i = 0; i < t.length; i++) if (t[i]! * 1000 <= nowMs) idx = i;
  return idx;
}

/** "YYYY-MM" of an epoch in the forecast's zone. */
function monthKey(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(ms).slice(0, 7);
  } catch {
    return new Date(ms).toISOString().slice(0, 7);
  }
}

/** Rainfall (liquid equivalent, mm) over the usual windows, observed so far and forecast ahead. */
export function rainTotals(r: RecentPrecip, nowMs: number): RainTotals {
  const di = dayIndex(r, nowMs);
  const midnight = di >= 0 ? r.daily.time[di]! * 1000 : null;
  const today = midnight != null ? (sumHours(r, midnight, nowMs) ?? 0) : null;

  // Month to date: whole days earlier this month, plus today so far.
  let monthToDate: number | null = null;
  if (di >= 0 && today != null) {
    const key = monthKey(nowMs, r.timezone);
    monthToDate = today;
    for (let i = di - 1; i >= 0; i--) {
      const t = r.daily.time[i]! * 1000;
      if (monthKey(t + 12 * HOUR, r.timezone) !== key) break;
      monthToDate += r.daily.precip[i] ?? 0;
    }
  }

  let dryDays: number | null = null;
  if (di >= 0) {
    if ((today ?? 0) >= 1) dryDays = 0;
    else
      for (let i = di - 1; i >= 0; i--) {
        if ((r.daily.precip[i] ?? 0) >= 1) {
          dryDays = di - i;
          break;
        }
      }
  }

  return {
    lastHour: sumHours(r, nowMs - HOUR, nowMs),
    today,
    last24h: sumHours(r, nowMs - 24 * HOUR, nowMs),
    last72h: sumHours(r, nowMs - 72 * HOUR, nowMs),
    last7d: sumHours(r, nowMs - 7 * 24 * HOUR, nowMs),
    last30d: sumHours(r, nowMs - 30 * 24 * HOUR, nowMs),
    monthToDate,
    next24h: sumHours(r, nowMs, nowMs + 24 * HOUR),
    next72h: sumHours(r, nowMs, nowMs + 72 * HOUR),
    dryDays,
  };
}

/** Daily totals for the last `past` days through the next `ahead` days (today included in `ahead`). */
export function dailyBars(r: RecentPrecip, nowMs: number, past = 14, ahead = 3): { time: number; mm: number; snowCm: number; future: boolean; today: boolean }[] {
  const di = dayIndex(r, nowMs);
  if (di < 0) return [];
  const out = [];
  for (let i = Math.max(0, di - past); i < Math.min(r.daily.time.length, di + ahead); i++) {
    out.push({ time: r.daily.time[i]! * 1000, mm: r.daily.precip[i] ?? 0, snowCm: r.daily.snow[i] ?? 0, future: i > di, today: i === di });
  }
  return out;
}
