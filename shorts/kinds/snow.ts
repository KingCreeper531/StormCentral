/**
 * Snow totals: the snowfall reports of the past 24 hours (NWS local storm
 * reports via the Iowa Environmental Mesonet; some are storm totals covering
 * more than a day, as lake-effect ones often are), posted mid-morning after a real snow:
 * a total of 6 inches or more and at least 8 reports of an inch or more.
 * Each place counts once, at its biggest report (spotters update a total as
 * the snow keeps falling).
 */
import { parseLsrGeoJson } from "../../src/lib/feeds/storm-parse";
import type { StormReport } from "../../src/lib/feeds/storm-reports";
import { DISCLAIMER, DISCLAIMER_ES, fitTitle, LINK_LINE, LINK_LINE_ES, longDayEs, shortDayEn, shortDayEs } from "../meta";
import { STATE_NAMES } from "../narration";
import { getJson, readVendor } from "../source";
import type { Kind } from "../video";

const IEM_LSR = "https://mesonet.agron.iastate.edu/geojson/lsr.geojson";
const WINDOW_MS = 24 * 3_600_000;
/** A real snow: the top total at least this many inches... */
export const ACTIVE_TOP_IN = 6;
/** ...and at least this many places with an inch or more. */
export const ACTIVE_REPORTS = 8;
/** Beyond this a report is a typo (the US 24-hour record is 76 inches). */
const MAX_IN = 100;
/** How many of the biggest totals the video lists. */
export const TOP_N = 5;

export interface SnowReport {
  /** Epoch ms of the (biggest) report. */
  time: number;
  lat: number;
  lon: number;
  inches: number;
  /** "Milton, FL" (the distance and direction prefix dropped). */
  place: string;
  state: string | null;
}

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const town = (r: StormReport) => r.place.replace(/^\d+(?:\.\d+)?\s+[NSEW]{1,3}\s+/i, "").trim();

/**
 * Snowfall reports in inches, one per place at its biggest. Sleet, freezing
 * rain and ice are winter reports too, but not snow.
 */
export function snowReports(reports: StormReport[]): SnowReport[] {
  const best = new Map<string, SnowReport>();
  for (const r of reports) {
    const t = r.typeText.toUpperCase();
    if (r.kind !== "snow" || !/SNOW|BLIZZARD/.test(t) || /SLEET|FREEZING|\bICE\b/.test(t)) continue;
    if (r.unit && !/^INCH/i.test(r.unit)) continue;
    const inches = r.magnitude ?? 0;
    if (inches < 0.1 || inches > MAX_IN) continue;
    // The same spot ("3 NW Milton") reported again later in the storm: keep its biggest total.
    const key = `${r.place.toUpperCase()}|${r.state ?? ""}`;
    const prev = best.get(key);
    if (prev && prev.inches >= inches) continue;
    best.set(key, { time: Date.parse(r.time), lat: r.lat, lon: r.lon, inches, place: [title(town(r)), r.state].filter(Boolean).join(", "), state: r.state });
  }
  return [...best.values()].sort((a, b) => a.inches - b.inches || a.time - b.time);
}

export interface SnowSummary {
  /** Places with a report. */
  total: number;
  /** Places with an inch or more, 6 or more, a foot or more. */
  inch: number;
  six: number;
  foot: number;
  /** The biggest totals, biggest first, one per town. */
  top: SnowReport[];
  /** States with the most places at an inch or more, most first (up to 3). */
  states: string[];
}

export function summarize(reports: SnowReport[]): SnowSummary {
  const byState = new Map<string, { n: number; max: number }>();
  for (const r of reports) {
    if (!r.state || r.inches < 1) continue;
    const x = byState.get(r.state) ?? { n: 0, max: 0 };
    byState.set(r.state, { n: x.n + 1, max: Math.max(x.max, r.inches) });
  }
  // One per town: "2 N Milton" and "Milton" are both Milton to a viewer.
  const top: SnowReport[] = [];
  for (const r of [...reports].sort((a, b) => b.inches - a.inches || a.time - b.time)) {
    if (top.length >= TOP_N) break;
    if (!top.some((x) => x.place === r.place)) top.push(r);
  }
  return {
    total: reports.length,
    inch: reports.filter((r) => r.inches >= 1).length,
    six: reports.filter((r) => r.inches >= 6).length,
    foot: reports.filter((r) => r.inches >= 12).length,
    top,
    // Ties go to the state with the bigger total.
    states: [...byState.entries()].sort((a, b) => b[1].n - a[1].n || b[1].max - a[1].max).slice(0, 3).map(([s]) => s),
  };
}

export const isActive = (s: SnowSummary) => (s.top[0]?.inches ?? 0) >= ACTIVE_TOP_IN && s.inch >= ACTIVE_REPORTS;

const list = (items: string[], and = "and") => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`);
/** 10 → "10", 8.5 → "8.5", 0.25 → "0.3". */
export const amount = (v: number) => String(Math.round(v * 10) / 10);
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const stateNames = (s: string[]) => s.map((x) => STATE_NAMES[x] ?? x);

export function snowTitle(s: SnowSummary, day: number): string {
  const top = s.top[0]!;
  const base = `Snow Totals, ${shortDayEn(day, "America/New_York")}`;
  return fitTitle(
    `${base}: Up to ${amount(top.inches)} in near ${top.place} #shorts`,
    `${base}: Up to ${amount(top.inches)} in #shorts`,
    `${base} #shorts`,
  );
}

export function snowDescription(s: SnowSummary): string {
  const where = s.states.length ? `, most of them in ${list(stateNames(s.states))}` : "";
  const top = s.top.map((r, i) => `${i + 1}. ${amount(r.inches)} in near ${r.place}`).join("\n");
  return [
    `Snow totals reported to the National Weather Service in the past 24 hours: ${n(s.inch, "place", "places")} reported an inch or more${where}${s.six ? `, and ${s.six} reported 6 inches or more` : ""}.`,
    `The biggest totals:\n${top}`,
    "These are preliminary local storm reports from trained spotters, observers and the public, via the Iowa Environmental Mesonet. Some are storm totals covering more than a day. Totals change as reports come in and are reviewed.",
    LINK_LINE,
    DISCLAIMER,
    "#weather #snow #snowtotals #winterstorm #shorts",
  ].join("\n\n");
}

export function snowEs(s: SnowSummary, day: number): { title: string; description: string } {
  const top = s.top[0]!;
  const cm = (v: number) => Math.round(v * 2.54);
  const base = `Nieve acumulada, ${shortDayEs(day, "America/New_York")}`;
  const where = s.states.length ? `, sobre todo en ${list(stateNames(s.states), "y")}` : "";
  return {
    title: fitTitle(`${base}: hasta ${amount(top.inches)} in (${cm(top.inches)} cm) #shorts`, `${base} #shorts`),
    description: [
      `Nieve acumulada reportada al Servicio Meteorológico Nacional en las últimas 24 horas, ${longDayEs(day, "America/New_York")}: ${n(s.inch, "lugar reportó", "lugares reportaron")} una pulgada (2.5 cm) o más${where}.`,
      `Los mayores acumulados:\n${s.top.map((r, i) => `${i + 1}. ${amount(r.inches)} in (${cm(r.inches)} cm) cerca de ${r.place}`).join("\n")}`,
      "Son reportes preliminares de observadores entrenados y el público, vía el Iowa Environmental Mesonet. Algunos son totales de tormentas de más de un día. Las cifras pueden cambiar al revisarse.",
      LINK_LINE_ES,
      DISCLAIMER_ES,
      "#clima #nieve #tormentainvernal #shorts",
    ].join("\n\n"),
  };
}

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, "");

export const snowKind: Kind = async (ctx) => {
  // SHORTS_SNOW_UNTIL: a past time to end the 24 hours at, to make the Short for an old storm (testing).
  const until = ctx.env.SHORTS_SNOW_UNTIL ? Date.parse(ctx.env.SHORTS_SNOW_UNTIL) : Date.now();
  if (!Number.isFinite(until)) throw new Error(`SHORTS_SNOW_UNTIL isn't a time: ${ctx.env.SHORTS_SNOW_UNTIL}`);
  const raw = await getJson<unknown>(ctx, "lsr.geojson", `${IEM_LSR}?sts=${stamp(until - WINDOW_MS)}&ets=${stamp(until)}`);
  const reports = snowReports(parseLsrGeoJson(raw));
  const s = summarize(reports);
  console.log(`Snow reports: ${s.total} places, ${s.inch} with an inch or more, ${s.six} with 6 or more; top ${s.top[0] ? `${amount(s.top[0].inches)} in near ${s.top[0].place}` : "none"}.`);
  if (!isActive(s) && ctx.env.SHORTS_LATEST !== "1") {
    console.log(`Not a snow day (under ${ACTIVE_TOP_IN} inches or fewer than ${ACTIVE_REPORTS} places with an inch); no video.`);
    return [];
  }
  if (!s.top.length) return [];
  const day = ctx.fixtures ? Math.max(...reports.map((r) => r.time)) : until;
  return [
    {
      key: "snow",
      template: "snow.html",
      title: snowTitle(s, day),
      description: snowDescription(s),
      tags: ["snow", "snow totals", "snowfall", "winter storm", "weather", "Storm Central", ...stateNames(s.states)],
      es: snowEs(s, day),
      playlist: "Snow Totals",
      data: {
        states: readVendor("states-10m.json"),
        date: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" }).format(day),
        // Smallest first: the map fills in up to the biggest.
        reports: reports.map((r) => ({ in: r.inches, lat: r.lat, lon: r.lon })),
        counts: { total: s.total, inch: s.inch, six: s.six, foot: s.foot },
        top: s.top.map((r) => ({ value: `${amount(r.inches)} in`, inches: r.inches, place: r.place, lat: r.lat, lon: r.lon })),
        // Not `states`: that's the map (common.js).
        topStates: stateNames(s.states),
      },
    },
  ];
};
