/**
 * Radar history. The national composite (IEM: N0R from 1995, N0Q since about
 * 2010) and Level II volumes (NOAA's archive on AWS) go back to 1995, and so
 * do IEM's warnings (county-based before October 2007, when warnings got
 * polygons). Its storm reports start in the mid-2000s, and the Level III
 * bucket in April 2020 (the super-res N0B and N0G in February 2022).
 */

export const ARCHIVE_START = Date.UTC(1995, 0, 1);
export const L3_ARCHIVE_START = Date.UTC(2020, 3, 1);

/** A moment to look back at, as epoch ms, or null when it's out of the archive's range (or not a time). */
export function archiveTime(value: string | number | null | undefined, now = Date.now()): number | null {
  if (value == null || value === "") return null;
  const t = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(t) && t >= ARCHIVE_START && t <= now ? Math.floor(t / 60_000) * 60_000 : null;
}

/**
 * Seconds a response may be cached: a day once the time asked for (`value`)
 * has settled (`settledMs` in the past: late reports have come in), `live` for
 * the present.
 */
export function archiveMaxAge(value: string | null, live: number, settledMs = 3_600_000, now = Date.now()): number {
  const t = archiveTime(value, now);
  return t != null && now - t > settledMs ? 86_400 : live;
}

/** `2013-05-20T20:00Z`: the minute, as the upstream archives take it. */
export const isoMinute = (t: number) => new Date(t).toISOString().slice(0, 16) + "Z";

export interface ArchiveEvent {
  id: string;
  name: string;
  /** When to look (UTC). */
  at: string;
  /** Where, and the radar that saw it. */
  lat: number;
  lon: number;
  site: string;
}

/** Storms worth looking back at: the moment each was at its worst. */
export const ARCHIVE_EVENTS: readonly ArchiveEvent[] = [
  { id: "moore-1999", name: "Bridge Creek–Moore tornado (1999)", at: "1999-05-04T00:00Z", lat: 35.33, lon: -97.49, site: "KTLX" },
  { id: "katrina-2005", name: "Hurricane Katrina landfall (2005)", at: "2005-08-29T11:10Z", lat: 29.3, lon: -89.6, site: "KLIX" },
  { id: "tuscaloosa-2011", name: "Tuscaloosa–Birmingham tornado (2011)", at: "2011-04-27T22:10Z", lat: 33.21, lon: -87.57, site: "KBMX" },
  { id: "joplin-2011", name: "Joplin tornado (2011)", at: "2011-05-22T22:40Z", lat: 37.08, lon: -94.51, site: "KSGF" },
  { id: "moore-2013", name: "Moore tornado (2013)", at: "2013-05-20T20:00Z", lat: 35.33, lon: -97.49, site: "KTLX" },
  { id: "el-reno-2013", name: "El Reno tornado (2013)", at: "2013-05-31T23:20Z", lat: 35.5, lon: -98.0, site: "KTLX" },
  { id: "harvey-2017", name: "Hurricane Harvey landfall (2017)", at: "2017-08-26T03:00Z", lat: 28.0, lon: -97.0, site: "KCRP" },
  { id: "derecho-2020", name: "Iowa derecho (2020)", at: "2020-08-10T17:45Z", lat: 41.98, lon: -91.67, site: "KDVN" },
  { id: "mayfield-2021", name: "Mayfield, Kentucky tornado (2021)", at: "2021-12-11T03:30Z", lat: 36.74, lon: -88.64, site: "KPAH" },
  { id: "ian-2022", name: "Hurricane Ian landfall (2022)", at: "2022-09-28T19:05Z", lat: 26.6, lon: -82.2, site: "KTBW" },
  { id: "rolling-fork-2023", name: "Rolling Fork tornado (2023)", at: "2023-03-25T01:10Z", lat: 32.9, lon: -90.88, site: "KDGX" },
];

const PARTS: Intl.DateTimeFormatOptions = { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" };

/** A moment's wall-clock fields in a zone (the device's when unset). */
function wallParts(t: number, timeZone: string | undefined) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { ...PARTS, timeZone }).formatToParts(t)) p[x.type] = x.value;
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour! % 24, mi: +p.minute!, s: +p.second! };
}

/** `2013-05-20T15:00`, as a `datetime-local` input shows `t` in the zone. */
export function toWallTime(t: number, timeZone?: string): string {
  const w = wallParts(t, timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** A `datetime-local` value read as wall-clock time in the zone → epoch ms (null if it isn't one). */
export function fromWallTime(wall: string, timeZone?: string): number | null {
  const m = wall.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const offset = (t: number) => {
    const w = wallParts(t, timeZone);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
  };
  // The zone's offset then; asked twice, since the first guess can land across a daylight-saving change.
  const guess = asUtc - offset(asUtc);
  const t = asUtc - offset(guess);
  return Number.isFinite(t) ? t : null;
}
