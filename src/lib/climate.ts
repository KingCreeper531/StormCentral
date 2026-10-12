/**
 * Climate context from NOAA's Applied Climate Information System (ACIS), the
 * source behind NWS climate pages: official 1991–2020 daily normals and the
 * record high, record low and wettest day for every calendar date, at the
 * nearest long-record station (a threaded NWS climate site where one exists,
 * which joins a city's older and newer stations into one record).
 *
 * The table has 366 slots indexed by month and day (Feb 29 included), so
 * any date maps to the same slot every year.
 */
import { haversineKm, type LatLon } from "./geo";

export const NORMALS_FROM = 1991;
export const NORMALS_TO = 2020;

export interface ClimateTable {
  /** "Pittsburgh Area", "BURBANK VALLEY PUMP PLANT" … */
  station: string;
  lat: number;
  lon: number;
  distanceKm: number;
  /** First and last year of the station's record. */
  recordYears: [number, number];
  normalYears: [number, number];
  /** Each array has 366 entries (see `climateSlot`); null where there is no data. °C and mm. */
  hi: (number | null)[];
  lo: (number | null)[];
  /** Normal precipitation per day (mm): sum the slots for a month total. */
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

// ─── ACIS ───────────────────────────────────────────────────────────────────

export interface AcisStation {
  name: string;
  /** Station id for StnData: the threaded id ("PITthr") when tried, else the station's own. */
  sid: string;
  /** FAA/WBAN-style id (sid type 3), used to try the threaded record: "PIT". */
  faa: string | null;
  lat: number;
  lon: number;
  distanceKm: number;
  start: string;
  end: string;
}

interface RawMeta {
  name?: string;
  sids?: string[];
  ll?: [number, number];
  valid_daterange?: [string, string][];
}

/**
 * Stations from StnMeta (`meta=name,sids,ll,valid_daterange`) that report now
 * and have at least 30 years of record, nearest first, with airports (which
 * carry the threaded city records) preferred when they're nearly as close.
 */
export function rankStations(raw: unknown, p: LatLon, nowMs: number): AcisStation[] {
  const list = (raw as { meta?: RawMeta[] })?.meta;
  if (!Array.isArray(list)) return [];
  const recent = new Date(nowMs - 45 * 86_400_000).toISOString().slice(0, 10);
  const oldest = new Date(nowMs - 30 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const out: (AcisStation & { score: number })[] = [];
  for (const m of list) {
    const range = m.valid_daterange?.[0];
    if (!m.ll || !m.sids?.length || !range || range[1] < recent || range[0] > oldest) continue;
    const faa = m.sids.find((s) => s.endsWith(" 3"))?.split(" ")[0] ?? null;
    const own = m.sids.find((s) => / (?:1|2|6)$/.test(s)) ?? m.sids[0]!;
    const distanceKm = haversineKm(p, { lat: m.ll[1], lon: m.ll[0] });
    // An airport counts as 25 km closer; each decade of record beyond 30 years as 3 km closer.
    const years = (Date.parse(range[1]) - Date.parse(range[0])) / (365.25 * 86_400_000);
    const score = distanceKm - (faa ? 25 : 0) - Math.max(0, years - 30) * 0.3;
    out.push({ name: m.name ?? "Station", sid: own.split(" ")[0]!, faa, lat: m.ll[1], lon: m.ll[0], distanceKm, start: range[0], end: range[1], score });
  }
  return out.sort((a, b) => a.score - b.score).map(({ score: _score, ...s }) => s);
}

/** "BURBANK VALLEY PUMP PLANT" → "Burbank Valley Pump Plant"; mixed case is left alone. */
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

const fToC = (f: number) => ((f - 32) * 5) / 9;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** ACIS values: numbers as strings, "T" (trace), "M" (missing), "S" / "A" flags on accumulations. */
function acisNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  if (v === "T") return 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

type SmryCell = [string, string];

/**
 * Build the table from two StnData responses: records (`sdate=por`, maxt / mint
 * / pcpn with `smry` max / min / max and `groupby: "year"`, `smry_only`) and
 * normals (`normal: "1"` for maxt, mint and pcpn over a leap year).
 */
export function buildClimate(records: unknown, normals: unknown, station: AcisStation, recordName?: string, recordRange?: [string, string]): ClimateTable {
  const smry = (records as { smry?: SmryCell[][] })?.smry ?? [];
  const rows = (normals as { data?: [string, ...unknown[]][] })?.data ?? [];
  const n = 366;
  const empty = () => new Array<number | null>(n).fill(null);
  const t = { hi: empty(), lo: empty(), precip: empty(), recHi: empty(), recHiYear: empty(), recLo: empty(), recLoYear: empty(), recPrecip: empty(), recPrecipYear: empty() };
  const fill = (cells: SmryCell[] | undefined, val: (number | null)[], year: (number | null)[], conv: (v: number) => number) => {
    cells?.slice(0, n).forEach((c, i) => {
      const v = acisNum(c?.[0]);
      if (v == null) return;
      val[i] = round1(conv(v));
      const y = Number(c?.[1]?.slice(0, 4));
      year[i] = Number.isFinite(y) && y > 0 ? y : null;
    });
  };
  fill(smry[0], t.recHi, t.recHiYear, fToC);
  fill(smry[1], t.recLo, t.recLoYear, fToC);
  fill(smry[2], t.recPrecip, t.recPrecipYear, (v) => v * 25.4);
  for (const r of rows) {
    const date = r[0];
    if (typeof date !== "string") continue;
    const s = slotOf(date);
    if (!(s >= 0 && s < n)) continue;
    const hi = acisNum(r[1]);
    const lo = acisNum(r[2]);
    const p = acisNum(r[3]);
    t.hi[s] = hi == null ? null : round1(fToC(hi));
    t.lo[s] = lo == null ? null : round1(fToC(lo));
    t.precip[s] = p == null ? null : Math.round(p * 25.4 * 100) / 100;
  }
  const range = recordRange ?? [station.start, station.end];
  return {
    station: titleCase(recordName ?? station.name),
    lat: station.lat,
    lon: station.lon,
    distanceKm: station.distanceKm,
    recordYears: [Number(range[0].slice(0, 4)), Number(range[1].slice(0, 4))],
    normalYears: [NORMALS_FROM, NORMALS_TO],
    ...t,
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
