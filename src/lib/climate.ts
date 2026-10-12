/**
 * Climate context from the ERA5 reanalysis (Open-Meteo historical archive):
 * normal highs, lows and rainfall for every day of the year (1991–2020, the
 * official normals period, smoothed over ±7 days) and the warmest, coldest
 * and wettest day on record for each calendar date.
 *
 * The table has 366 slots indexed by month and day (Feb 29 included), so
 * any date maps to the same slot every year.
 */

export const NORMALS_FROM = 1991;
export const NORMALS_TO = 2020;
const SMOOTH_DAYS = 7;

export interface ClimateTable {
  lat: number;
  lon: number;
  /** First and last year searched for records. */
  recordYears: [number, number];
  normalYears: [number, number];
  /** Each array has 366 entries (see `climateSlot`); null where there is no data. °C and mm. */
  hi: (number | null)[];
  lo: (number | null)[];
  /** Normal rainfall per day (mm), smoothed: sum the slots for a month total. */
  precip: (number | null)[];
  recHi: (number | null)[];
  recHiYear: (number | null)[];
  recLo: (number | null)[];
  recLoYear: (number | null)[];
  recPrecip: (number | null)[];
  recPrecipYear: (number | null)[];
}

const MONTH_START = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

/** 0–365: Jan 1 = 0, Feb 29 = 59, Mar 1 = 60, Dec 31 = 365. */
export function climateSlot(month: number, day: number): number {
  return MONTH_START[month - 1]! + day - 1;
}

/** Slot for a "YYYY-MM-DD" date. */
export const slotOf = (iso: string) => climateSlot(Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));

const round1 = (v: number) => Math.round(v * 10) / 10;

function add(sums: Float64Array, counts: Float64Array, i: number, v: number) {
  sums[i] = sums[i]! + v;
  counts[i] = counts[i]! + 1;
}

interface RawArchive {
  latitude?: number;
  longitude?: number;
  daily?: { time?: string[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; precipitation_sum?: (number | null)[] };
}

/** Build the table from an archive response with `timeformat=iso8601` daily max/min temperature and precipitation. */
export function buildClimate(input: unknown): ClimateTable {
  const raw = input as RawArchive;
  const d = raw.daily ?? {};
  const time = d.time ?? [];
  const tx = d.temperature_2m_max ?? [];
  const tn = d.temperature_2m_min ?? [];
  const pr = d.precipitation_sum ?? [];
  const n = 366;
  const sum = { hi: new Float64Array(n), lo: new Float64Array(n), p: new Float64Array(n) };
  const cnt = { hi: new Float64Array(n), lo: new Float64Array(n), p: new Float64Array(n) };
  const rec = {
    hi: new Array<number | null>(n).fill(null),
    hiY: new Array<number | null>(n).fill(null),
    lo: new Array<number | null>(n).fill(null),
    loY: new Array<number | null>(n).fill(null),
    p: new Array<number | null>(n).fill(null),
    pY: new Array<number | null>(n).fill(null),
  };
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < time.length; i++) {
    const t = time[i]!;
    const year = Number(t.slice(0, 4));
    const s = slotOf(t);
    if (!(s >= 0 && s < n)) continue;
    const inNormals = year >= NORMALS_FROM && year <= NORMALS_TO;
    const h = tx[i];
    const l = tn[i];
    const p = pr[i];
    if (typeof h === "number") {
      y0 = Math.min(y0, year);
      y1 = Math.max(y1, year);
      if (inNormals) add(sum.hi, cnt.hi, s, h);
      // Ties keep the most recent year.
      if (rec.hi[s] == null || h >= rec.hi[s]!) {
        rec.hi[s] = h;
        rec.hiY[s] = year;
      }
    }
    if (typeof l === "number") {
      if (inNormals) add(sum.lo, cnt.lo, s, l);
      if (rec.lo[s] == null || l <= rec.lo[s]!) {
        rec.lo[s] = l;
        rec.loY[s] = year;
      }
    }
    if (typeof p === "number") {
      if (inNormals) add(sum.p, cnt.p, s, p);
      if (rec.p[s] == null || p >= rec.p[s]!) {
        rec.p[s] = p;
        rec.pY[s] = year;
      }
    }
  }

  // ±7-day circular window. Feb 29 has a quarter of the samples, so it is
  // weighted by its count like every other slot.
  const smooth = (s: Float64Array, c: Float64Array) => {
    const out = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      let a = 0;
      let b = 0;
      for (let k = -SMOOTH_DAYS; k <= SMOOTH_DAYS; k++) {
        const j = (i + k + n) % n;
        a += s[j]!;
        b += c[j]!;
      }
      out[i] = b > 0 ? round1(a / b) : null;
    }
    return out;
  };
  const r = (arr: (number | null)[]) => arr.map((v) => (v == null ? null : round1(v)));

  return {
    lat: raw.latitude ?? Number.NaN,
    lon: raw.longitude ?? Number.NaN,
    recordYears: Number.isFinite(y0) ? [y0, y1] : [0, 0],
    normalYears: [NORMALS_FROM, NORMALS_TO],
    hi: smooth(sum.hi, cnt.hi),
    lo: smooth(sum.lo, cnt.lo),
    precip: smooth(sum.p, cnt.p).map((v) => (v == null ? null : Math.round(v * 100) / 100)),
    recHi: r(rec.hi),
    recHiYear: rec.hiY,
    recLo: r(rec.lo),
    recLoYear: rec.loY,
    recPrecip: r(rec.p),
    recPrecipYear: rec.pY,
  };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Normal rainfall (mm) from the 1st of the month through `iso` inclusive, and
 * for the whole month. Feb 29 counts only in leap years.
 */
export function normalPrecipToDate(c: ClimateTable, iso: string): { toDate: number; month: number } | null {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const days = m === 2 ? (isLeap(y) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  let toDate = 0;
  let month = 0;
  for (let dd = 1; dd <= days; dd++) {
    const v = c.precip[climateSlot(m, dd)];
    if (v == null) return null;
    month += v;
    if (dd <= day) toDate += v;
  }
  return { toDate, month };
}

/** Normal rainfall (mm) over the `n` days ending on `iso` (inclusive). */
export function normalPrecipOver(c: ClimateTable, iso: string, n: number): number | null {
  const end = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = c.precip[slotOf(new Date(end - i * 86_400_000).toISOString().slice(0, 10))];
    if (v == null) return null;
    total += v;
  }
  return total;
}

/** "YYYY-MM-DD" of an instant in `timeZone` (the device's date if the zone is unknown). */
export function isoDateIn(ms: number, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  } catch {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}
