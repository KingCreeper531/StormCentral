/**
 * The weather week in review: a full-length 16:9 video, Sunday afternoons.
 * The past seven storm days (12Z to 12Z) of NWS local storm reports (via the
 * Iowa Environmental Mesonet) on the US map with a day-by-day chart, then the
 * busiest storm days one by one: the national radar composite (IEM's NEXRAD
 * archive) looping over the hours they were busiest, the reports popping up
 * as they came in, beside the day's numbers; then the week's snow, when
 * there was a real one. Posted only when the week had a storm day (a tornado
 * report, or 15 severe reports) or a snow of 6 inches or more.
 */
import { parseLsrGeoJson } from "../../src/lib/feeds/storm-parse";
import type { StormReport } from "../../src/lib/feeds/storm-reports";
import { compactUtc, IEM_TILE_ROOT, MOSAIC_SITE } from "../../src/lib/radar/frames";
import { DISCLAIMER, DISCLAIMER_ES, fitTitle, LINK_LINE, LINK_LINE_ES, SITE } from "../meta";
import { STATE_NAMES } from "../narration";
import { getJson, readVendor } from "../source";
import type { Kind, Video } from "../video";
import { dayStart, severeReports, summarize as summarizeSevere, type RecapReport, type RecapSummary } from "./recap";
import { amount, snowReports, summarize as summarizeSnow, type SnowSummary } from "./snow";

const IEM_LSR = "https://mesonet.agron.iastate.edu/geojson/lsr.geojson";
const DAY_MS = 86_400_000;
export const WEEK_DAYS = 7;
/** A storm day: a tornado report, or this many severe reports. */
export const STORM_DAY_REPORTS = 15;
/** At most this many storm days get their own radar segment. */
export const MAX_DAYS = 3;
/** The radar loop covers the busiest this-many hours of a day, a frame every FRAME_MIN minutes. */
export const LOOP_HOURS = 6;
export const FRAME_MIN = 20;
/** A real snow: a total of at least this many inches. */
export const SNOW_IN = 6;
/** The radar view on the page (review.html VIEW), for the map's shape and the tiles' zoom. */
const VIEW_W = 1180;
const VIEW_H = 800;
const WORDS_PER_SECOND = 2.6;

// ── The week's days ─────────────────────────────────────────────────────────

export interface ReviewDay {
  /** Epoch ms of the storm day's 12Z start. */
  start: number;
  reports: RecapReport[];
  summary: RecapSummary;
  floods: number;
}

/** Floods and flash floods reported (not counted as severe). */
const floodReports = (reports: StormReport[]) => reports.filter((r) => r.kind === "flood");

/** The seven storm days before `end` (a 12Z), each with its severe reports and floods. */
export function weekDays(reports: StormReport[], end: number): ReviewDay[] {
  const severe = severeReports(reports);
  const floods = floodReports(reports);
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const start = end - (WEEK_DAYS - i) * DAY_MS;
    const inDay = (t: number) => t >= start && t < start + DAY_MS;
    const mine = severe.filter((r) => inDay(r.time));
    return { start, reports: mine, summary: summarizeSevere(mine), floods: floods.filter((r) => inDay(Date.parse(r.time))).length };
  });
}

export const isStormDay = (d: ReviewDay) => d.summary.counts.tornado > 0 || d.summary.total >= STORM_DAY_REPORTS;
const score = (d: ReviewDay) => d.summary.counts.tornado * 4 + d.summary.total;

/** The busiest storm days (up to MAX_DAYS), in the order they happened. */
export function stormDays(days: ReviewDay[]): ReviewDay[] {
  return days
    .filter(isStormDay)
    .sort((a, b) => score(b) - score(a) || a.start - b.start)
    .slice(0, MAX_DAYS)
    .sort((a, b) => a.start - b.start);
}

/** The `hours` with the most reports: [start, end] in epoch ms, on 5-minute marks (the radar archive's). */
export function busiestWindow(times: number[], hours = LOOP_HOURS): [number, number] {
  const t = [...times].sort((a, b) => a - b);
  const span = hours * 3_600_000;
  let best = 0, bestStart = t[0] ?? 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[j]! < t[i]! - span) j++;
    // The window ending at t[i] holds t[j..i].
    if (i - j + 1 > best) [best, bestStart] = [i - j + 1, t[i]! - span];
  }
  // Centre the busy part: start a little before the first report in it.
  const first = t.find((x) => x >= bestStart) ?? bestStart;
  const start = Math.floor((Math.max(bestStart, first - span / 6)) / 300_000) * 300_000;
  return [start, start + span];
}

// ── The radar view ──────────────────────────────────────────────────────────

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const latOf = (y: number) => deg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);
const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))]!;

export interface RadarView {
  west: number;
  east: number;
  south: number;
  north: number;
  /** Web Mercator tiles: zoom and the x/y ranges (inclusive) that cover the view. */
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => Math.floor(((1 - mercY(lat) / Math.PI) / 2) * 2 ** z);

/**
 * The view around the reports (the odd far-off one left out), padded, at
 * least 7° by 4.5°, widened to the page's radar box (Web Mercator, as the
 * tiles are), with the tile zoom that fills it without upscaling much.
 */
export function radarView(points: { lat: number; lon: number }[]): RadarView {
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  const lats = points.map((p) => p.lat).sort((a, b) => a - b);
  const lo = points.length > 12 ? 0.05 : 0;
  let west = q(lons, lo) - 1.5, east = q(lons, 1 - lo) + 1.5, south = q(lats, lo) - 1, north = q(lats, 1 - lo) + 1;
  const grow = (a: number, b: number, min: number): [number, number] => (b - a >= min ? [a, b] : [(a + b) / 2 - min / 2, (a + b) / 2 + min / 2]);
  [west, east] = grow(west, east, 7);
  [south, north] = grow(south, north, 4.5);
  // Match the box's shape in Mercator units (x = radians of longitude).
  const xSpan = rad(east - west), ySpan = mercY(north) - mercY(south), aspect = VIEW_W / VIEW_H;
  if (xSpan / ySpan < aspect) {
    const add = deg((ySpan * aspect - xSpan) / 2);
    [west, east] = [west - add, east + add];
  } else {
    const mid = (mercY(north) + mercY(south)) / 2, half = xSpan / aspect / 2;
    [south, north] = [latOf(mid - half), latOf(mid + half)];
  }
  // The biggest zoom whose map is at most about the box's width (tiles drawn at 1x or a little more).
  let z = 4;
  for (let k = 8; k >= 4; k--) {
    if (((east - west) / 360) * 256 * 2 ** k <= VIEW_W * 1.15) { z = k; break; }
  }
  return { west, east, south, north, z, x0: tileX(west, z), x1: tileX(east, z), y0: tileY(north, z), y1: tileY(south, z) };
}

/** The archived national composite (N0Q) for one 5-minute time, as an XYZ tile template. */
export const mosaicTiles = (t: number) => `${IEM_TILE_ROOT}/ridge::${MOSAIC_SITE}-N0Q-${compactUtc(new Date(t))}/{z}/{x}/{y}.png`;

/** Frame times across a loop window, every FRAME_MIN minutes. */
export const frameTimes = ([a, b]: [number, number]) => Array.from({ length: Math.floor((b - a) / (FRAME_MIN * 60_000)) + 1 }, (_, i) => a + i * FRAME_MIN * 60_000);

// ── Words ───────────────────────────────────────────────────────────────────

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const list = (items: string[], and = "and") => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`);
const names = (states: string[]) => states.map((s) => STATE_NAMES[s] ?? s);
/** Hail and snow as reported: 1.75, 2, 10.5. */
const num = (v: number) => (v % 1 ? v.toFixed(2).replace(/0$/, "") : String(v));
const inches = (v: number) => `${num(v)} inches`;
const fmt = (opts: Intl.DateTimeFormatOptions, locale = "en-US") => (ms: number) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(ms);
/** A storm day is named for the date it starts on (12Z), as SPC does. */
const weekday = fmt({ weekday: "long" });
const monthDay = fmt({ month: "short", day: "numeric" });
const longDay = fmt({ weekday: "long", month: "long", day: "numeric" });

/** "Oct 12–18, 2026", or "Sep 28 – Oct 4, 2026" across months. */
export function weekRange(start: number, locale = "en-US"): string {
  const last = start + (WEEK_DAYS - 1) * DAY_MS;
  const m = fmt({ month: "short" }, locale), d = fmt({ day: "numeric" }, locale), y = fmt({ year: "numeric" }, locale);
  return m(start) === m(last) ? `${m(start)} ${d(start)}–${d(last)}, ${y(last)}` : `${m(start)} ${d(start)} – ${m(last)} ${d(last)}, ${y(last)}`;
}

/** "2 tornado reports, 17 damaging wind reports and 13 large hail reports", leaving out the kinds with none. */
const kindsLine = (c: { tornado: number; wind: number; hail: number }) =>
  list(
    [
      c.tornado ? n(c.tornado, "tornado report", "tornado reports") : "",
      c.wind ? n(c.wind, "damaging wind report", "damaging wind reports") : "",
      c.hail ? n(c.hail, "large hail report", "large hail reports") : "",
    ].filter(Boolean),
  );

// ── The video's beats ───────────────────────────────────────────────────────

export interface Beat {
  /** What the narrator says. */
  say: string;
  /** A short line on screen with it (the side panel's bullet). */
  bullet?: string;
  /** Seconds it stays up at least. */
  min?: number;
}

export interface Scene {
  type: "intro" | "overview" | "day" | "snow";
  title: string;
  /** For "day": its index in DATA.days. */
  day?: number;
  beats: Beat[];
}

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
export const beatSeconds = (b: Beat) => Math.max(b.min ?? 4, words(b.say) / WORDS_PER_SECOND + 1.1);

/** Start times: each beat as long as its line (or its minimum), scenes one after another. */
export function timeline(scenes: Scene[]) {
  let t = 0;
  const chapters: { title: string; start: number; end: number; type: Scene["type"]; day?: number }[] = [];
  const beats: { say: string; bullet?: string; start: number; dur: number; chapter: number }[] = [];
  scenes.forEach((s, ci) => {
    const start = t;
    for (const b of s.beats) {
      const dur = beatSeconds(b);
      beats.push({ say: b.say, bullet: b.bullet, start: t, dur, chapter: ci });
      t += dur;
    }
    chapters.push({ title: s.title, start, end: t, type: s.type, day: s.day });
  });
  return { chapters, beats, end: t };
}

export function reviewScenes(days: ReviewDay[], picked: ReviewDay[], snow: SnowSummary | null, range: string): Scene[] {
  const total = { tornado: 0, wind: 0, hail: 0 };
  for (const d of days) for (const k of ["tornado", "wind", "hail"] as const) total[k] += d.summary.counts[k];
  const severe = total.tornado + total.wind + total.hail;
  const floods = days.reduce((s, d) => s + d.floods, 0);
  const busiest = days.reduce<ReviewDay | null>((b, d) => (d.summary.total > (b?.summary.total ?? 0) ? d : b), null);
  const scenes: Scene[] = [
    { type: "intro", title: "Intro", beats: [{ say: `Here's your weather week in review, for ${range.replace(/–/g, " to ").replace(/, (\d{4})$/, "")}.`, min: 5 }] },
    {
      type: "overview",
      title: "The week",
      beats: [
        severe
          ? { say: `${n(severe, "severe weather report", "severe weather reports")} came in this week: ${kindsLine(total)}.`, bullet: `${severe} severe reports`, min: 6 }
          : { say: "It was a quiet week for severe storms.", bullet: "A quiet week for severe storms", min: 6 },
        ...(busiest ? [{ say: `The busiest day was ${weekday(busiest.start)}, with ${n(busiest.summary.total, "report", "reports")}.`, bullet: `Busiest: ${weekday(busiest.start)}` }] : []),
        ...(floods ? [{ say: floods === 1 ? "There was also 1 flood report." : `There were also ${floods} flood reports.`, bullet: n(floods, "flood report", "flood reports") }] : []),
      ],
    },
  ];
  picked.forEach((d, i) => {
    const s = d.summary, where = names(s.states.slice(0, 3));
    const beats: Beat[] = [
      { say: `${weekday(d.start)}${where.length ? `: storms hit ${list(where)}` : ""}.`, bullet: where.length ? list(where) : undefined, min: 5 },
      { say: `There were ${kindsLine(s.counts)}.`, bullet: `${s.total} severe reports`, min: 5 },
    ];
    if (s.counts.tornado && s.tornadoStates.length) beats.push({ say: `Tornado reports came from ${list(names(s.tornadoStates))}.`, bullet: `Tornadoes: ${list(s.tornadoStates)}` });
    if (s.hail?.magnitude) beats.push({ say: `The largest hail was ${inches(s.hail.magnitude)}, near ${s.hail.place}.`, bullet: `Hail to ${num(s.hail.magnitude)} in` });
    if (s.wind?.magnitude) beats.push({ say: `The strongest gust was ${Math.round(s.wind.magnitude)} mph, near ${s.wind.place}.`, bullet: `Gusts to ${Math.round(s.wind.magnitude)} mph` });
    // The radar loop needs time to play: at least 18 seconds a day.
    const shortBy = 18 - beats.reduce((t, b) => t + beatSeconds(b), 0);
    if (shortBy > 0) beats[0]!.min = beatSeconds(beats[0]!) + shortBy;
    scenes.push({ type: "day", title: `${weekday(d.start)}, ${monthDay(d.start)}`, day: i, beats });
  });
  if (snow?.top[0]) {
    const top = snow.top[0];
    scenes.push({
      type: "snow",
      title: "Snow",
      beats: [
        { say: snow.six ? `Snow fell too: ${n(snow.six, "place", "places")} reported 6 inches or more.` : `Snow fell too, up to ${inches(top.inches)}.`, bullet: `${snow.six} places with 6+ in`, min: 6 },
        { say: `The biggest total was ${inches(top.inches)}, near ${top.place}.`, bullet: `Top: ${amount(top.inches)} in` },
      ],
    });
  }
  scenes.push({ type: "intro", title: "That's the week", beats: [{ say: "That's your week in weather. See you next Sunday.", min: 4 }] });
  return scenes;
}

// ── Titles ──────────────────────────────────────────────────────────────────

export function reviewTitle(range: string, days: ReviewDay[], snow: SnowSummary | null): string {
  const tornado = days.reduce((s, d) => s + d.summary.counts.tornado, 0);
  const hail = Math.max(0, ...days.map((d) => d.summary.hail?.magnitude ?? 0));
  const parts = [tornado ? n(tornado, "Tornado Report", "Tornado Reports") : null, hail >= 1 ? `Hail to ${num(hail)} in` : null, snow?.top[0] && snow.top[0].inches >= SNOW_IN ? `Snow to ${amount(snow.top[0].inches)} in` : null].filter(
    (p): p is string => !!p,
  );
  const base = `Weather Week in Review: ${range}`;
  return fitTitle(parts.length ? `${base} | ${parts.slice(0, 2).join(", ")}` : base, base);
}

const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ── The kind ────────────────────────────────────────────────────────────────

const iemStamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, "");

export const reviewKind: Kind = async (ctx) => {
  // SHORTS_REVIEW_UNTIL: a past time to end the week at, to make an old week's (testing).
  const until = ctx.env.SHORTS_REVIEW_UNTIL ? Date.parse(ctx.env.SHORTS_REVIEW_UNTIL) : Date.now();
  if (!Number.isFinite(until)) throw new Error(`SHORTS_REVIEW_UNTIL isn't a time: ${ctx.env.SHORTS_REVIEW_UNTIL}`);
  const end = dayStart(until);
  const start = end - WEEK_DAYS * DAY_MS;
  const raw = parseLsrGeoJson(await getJson<unknown>(ctx, "lsr-week.geojson", `${IEM_LSR}?sts=${iemStamp(start)}&ets=${iemStamp(end)}`));
  const days = weekDays(raw, end);
  const picked = stormDays(days);
  const snowAll = snowReports(raw.filter((r) => Date.parse(r.time) >= start && Date.parse(r.time) < end));
  const snowSum = summarizeSnow(snowAll);
  const snow = (snowSum.top[0]?.inches ?? 0) >= SNOW_IN ? snowSum : null;
  console.log(
    `Week of ${weekRange(start)}: ${days.map((d) => `${weekday(d.start).slice(0, 3)} ${d.summary.total}`).join(", ")}; storm days ${picked.map((d) => weekday(d.start)).join(", ") || "none"}; snow ${snow ? `${amount(snow.top[0]!.inches)} in` : "none"}.`,
  );
  if (!picked.length && !snow && ctx.env.SHORTS_LATEST !== "1") {
    console.log("No storm day or real snow this week; no video.");
    return [];
  }

  const range = weekRange(start);
  const scenes = reviewScenes(days, picked, snow, range);
  const tl = timeline(scenes);
  const chapterLines = tl.chapters.map((c) => `${stamp(c.start)} ${c.title}`).concat(`${stamp(tl.end)} End`);
  const tornado = days.reduce((s, d) => s + d.summary.counts.tornado, 0);
  const severe = days.reduce((s, d) => s + d.summary.total, 0);

  const video: Video = {
    key: `review-${new Date(start).toISOString().slice(0, 10)}`,
    template: "review.html",
    title: reviewTitle(range, days, snow),
    description: [
      `The weather week of ${range}, from the National Weather Service's storm reports: ${n(severe, "severe weather report", "severe weather reports")} (${kindsLine(
        days.reduce((c, d) => ({ tornado: c.tornado + d.summary.counts.tornado, wind: c.wind + d.summary.counts.wind, hail: c.hail + d.summary.counts.hail }), { tornado: 0, wind: 0, hail: 0 }),
      )})${picked.length ? `, with a look back at ${list(picked.map((d) => longDay(d.start)))} on radar` : ""}${snow ? `, and the week's snow` : ""}.`,
      `Chapters:\n${chapterLines.join("\n")}`,
      "Storm reports are preliminary local storm reports from trained spotters, emergency managers and the public, via the Iowa Environmental Mesonet; totals change as they're reviewed. Radar: the NEXRAD national composite from the Iowa Environmental Mesonet's archive. Storm days run 7 AM to 7 AM Central.",
      `Watch live radar, warnings and storm reports, free: ${SITE}`,
      LINK_LINE,
      DISCLAIMER,
      "#weather #severeweather #weekinreview #radar #stormreports",
    ].join("\n\n"),
    tags: ["weather", "week in review", "severe weather", "storm reports", "radar", "Storm Central", ...(tornado ? ["tornado"] : []), ...(snow ? ["snow"] : [])],
    es: {
      title: fitTitle(`Resumen semanal del clima: ${weekRange(start, "es-MX")}`),
      description: [
        `La semana del ${weekRange(start, "es-MX")} en reportes de tormentas del Servicio Meteorológico Nacional: ${n(severe, "reporte de clima severo", "reportes de clima severo")}${tornado ? `, ${tornado} de ellos de tornado` : ""}.`,
        `Capítulos:\n${chapterLines.join("\n")}`,
        "Reportes preliminares vía el Iowa Environmental Mesonet. Radar: compuesto nacional NEXRAD del archivo del Iowa Environmental Mesonet.",
        LINK_LINE_ES,
        DISCLAIMER_ES,
        "#clima #tormentas #resumen #radar",
      ].join("\n\n"),
    },
    playlist: "Week in Review",
    size: { width: 1920, height: 1080 },
    thumbnailAt: 0,
    // The radar tiles load in the page; the renderer lets the canvas use them (render.ts).
    cors: [`${IEM_TILE_ROOT}/**`],
    data: {
      states: readVendor("states-10m.json"),
      range,
      chapters: tl.chapters,
      beats: tl.beats,
      end: tl.end,
      week: {
        days: days.map((d) => ({ short: weekday(d.start).slice(0, 3), counts: d.summary.counts, total: d.summary.total, storm: picked.includes(d) })),
        reports: days.flatMap((d) => d.reports.map((r) => ({ k: r.kind, lat: r.lat, lon: r.lon, d: Math.floor((r.time - start) / DAY_MS) }))),
        totals: { severe, tornado, floods: days.reduce((s, d) => s + d.floods, 0) },
      },
      days: picked.map((d) => {
        const window = busiestWindow(d.reports.map((r) => r.time));
        const view = radarView(d.reports);
        const zone = "America/Chicago";
        return {
          title: longDay(d.start),
          short: weekday(d.start),
          counts: d.summary.counts,
          total: d.summary.total,
          states: names(d.summary.states.slice(0, 3)),
          view,
          frames: frameTimes(window).map((t) => ({ t, tiles: mosaicTiles(t), label: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t) })),
          reports: d.reports.filter((r) => r.time >= window[0] && r.time <= window[1]).map((r) => ({ k: r.kind, t: r.time, lat: r.lat, lon: r.lon })),
          highlights: [
            d.summary.hail?.magnitude ? { label: "Largest hail", value: `${num(d.summary.hail.magnitude)} in`, place: d.summary.hail.place, kind: "hail" } : null,
            d.summary.wind?.magnitude ? { label: "Strongest gust", value: `${Math.round(d.summary.wind.magnitude)} mph`, place: d.summary.wind.place, kind: "wind" } : null,
            d.summary.counts.tornado ? { label: "Tornado reports", value: String(d.summary.counts.tornado), place: list(d.summary.tornadoStates), kind: "tornado" } : null,
          ].filter(Boolean),
        };
      }),
      snow: snow && {
        six: snow.six,
        foot: snow.foot,
        reports: snowAll.filter((r) => r.inches >= 1).map((r) => ({ in: r.inches, lat: r.lat, lon: r.lon })),
        top: snow.top.map((r) => ({ value: `${amount(r.inches)} in`, inches: r.inches, place: r.place, lat: r.lat, lon: r.lon })),
      },
      thumb: {
        lines: ["WEEK IN", "REVIEW"],
        stat: tornado ? n(tornado, "TORNADO REPORT", "TORNADO REPORTS") : snow ? `SNOW TO ${amount(snow.top[0]!.inches)} IN` : `${severe} SEVERE REPORTS`,
      },
    },
  };
  return [video];
};
