/**
 * The evening storm report recap: the day's severe weather reports (NWS local
 * storm reports via the Iowa Environmental Mesonet, from 7 AM Central), on
 * active days only: at least one tornado report, or 15 severe reports.
 */
import { parseLsrGeoJson } from "../../src/lib/feeds/storm-parse";
import type { StormReport } from "../../src/lib/feeds/storm-reports";
import { DISCLAIMER, DISCLAIMER_ES, fitTitle, LINK_LINE, LINK_LINE_ES, longDayEs, shortDayEn, shortDayEs } from "../meta";
import { getJson, readVendor } from "../source";
import type { Kind } from "../video";

const IEM_LSR = "https://mesonet.agron.iastate.edu/geojson/lsr.geojson";
/** Severe: hail 1 inch or larger, wind gusts 58 mph or more, any thunderstorm wind damage, any tornado. */
const SEVERE_HAIL_IN = 1;
const SEVERE_WIND_MPH = 58;
export const ACTIVE_TOTAL = 15;
/** Beyond these, a report is a typo (a 65 mph gust filed as 65-inch hail, say): the records are 8 in and about 150 mph. */
const MAX_HAIL_IN = 8;
const MAX_WIND_MPH = 160;

export type RecapKind = "tornado" | "hail" | "wind";

export interface RecapReport {
  kind: RecapKind;
  /** Epoch ms. */
  time: number;
  lat: number;
  lon: number;
  /** Inches of hail or mph of wind; null when not given (wind damage, most tornadoes). */
  magnitude: number | null;
  /** "Amarillo, TX" (the distance and direction prefix dropped). */
  place: string;
  state: string | null;
}

const placeOf = (r: StormReport) => {
  const town = r.place.replace(/^\d+(?:\.\d+)?\s+[NSEW]{1,3}\s+/i, "").trim();
  const name = town.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return [name, r.state].filter(Boolean).join(", ");
};

/** Only severe thunderstorm reports over land: tornadoes, severe hail, severe gusts and wind damage. */
export function severeReports(reports: StormReport[]): RecapReport[] {
  const out: RecapReport[] = [];
  for (const r of reports) {
    const t = r.typeText.toUpperCase();
    if (t.startsWith("MARINE") || t.includes("NON-TSTM") || t.includes("NON TSTM")) continue;
    let kind: RecapKind | null = null;
    if (r.kind === "tornado") kind = "tornado";
    else if (r.kind === "hail" && (r.magnitude ?? 0) >= SEVERE_HAIL_IN) kind = "hail";
    else if (r.kind === "wind-damage" || (r.kind === "wind" && (r.magnitude ?? 0) >= SEVERE_WIND_MPH)) kind = "wind";
    if (!kind) continue;
    if ((kind === "hail" && (r.magnitude ?? 0) > MAX_HAIL_IN) || (kind === "wind" && (r.magnitude ?? 0) > MAX_WIND_MPH)) continue;
    out.push({ kind, time: Date.parse(r.time), lat: r.lat, lon: r.lon, magnitude: kind === "tornado" ? null : r.magnitude, place: placeOf(r), state: r.state });
  }
  return out.sort((a, b) => a.time - b.time);
}

export interface RecapSummary {
  counts: Record<RecapKind, number>;
  total: number;
  /** States with the most reports, most first (up to 4). */
  states: string[];
  /** States with tornado reports, most first (up to 3). */
  tornadoStates: string[];
  hail: RecapReport | null;
  wind: RecapReport | null;
}

export function summarize(reports: RecapReport[]): RecapSummary {
  const counts: Record<RecapKind, number> = { tornado: 0, hail: 0, wind: 0 };
  const byState = new Map<string, number>();
  const tornadoByState = new Map<string, number>();
  let hail: RecapReport | null = null;
  let wind: RecapReport | null = null;
  for (const r of reports) {
    counts[r.kind]++;
    if (r.state) byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
    if (r.state && r.kind === "tornado") tornadoByState.set(r.state, (tornadoByState.get(r.state) ?? 0) + 1);
    if (r.kind === "hail" && (r.magnitude ?? 0) > (hail?.magnitude ?? 0)) hail = r;
    if (r.kind === "wind" && (r.magnitude ?? 0) > (wind?.magnitude ?? 0)) wind = r;
  }
  const top = (m: Map<string, number>, k: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([s]) => s);
  return { counts, total: reports.length, states: top(byState, 4), tornadoStates: top(tornadoByState, 3), hail, wind };
}

export const isActive = (s: RecapSummary) => s.counts.tornado > 0 || s.total >= ACTIVE_TOTAL;

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const list = (items: string[], and = "and") => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`);
const inches = (v: number) => `${v % 1 ? v.toFixed(2).replace(/0$/, "") : v} in`;

export function recapTitle(s: RecapSummary, day: number): string {
  const parts = [
    s.counts.tornado ? n(s.counts.tornado, "Tornado Report", "Tornado Reports") : null,
    s.hail?.magnitude ? `Hail to ${inches(s.hail.magnitude)}` : null,
    s.wind?.magnitude ? `${Math.round(s.wind.magnitude)} mph Gusts` : null,
  ].filter((p): p is string => !!p);
  const base = `Severe Weather Reports, ${shortDayEn(day)}`;
  return fitTitle(
    `${base}: ${parts.slice(0, 2).join(", ") || n(s.total, "Report", "Reports")} #shorts`,
    `${base}: ${parts[0] ?? n(s.total, "Report", "Reports")} #shorts`,
    `${base} #shorts`,
  );
}

export function recapDescription(s: RecapSummary): string {
  const where = s.states.length ? `, most of them in ${list(s.states)}` : "";
  const highlights = [
    s.hail?.magnitude ? `Largest hail: ${inches(s.hail.magnitude)} near ${s.hail.place}.` : null,
    s.wind?.magnitude ? `Strongest gust: ${Math.round(s.wind.magnitude)} mph near ${s.wind.place}.` : null,
  ].filter(Boolean);
  return [
    `Today's severe weather reports from the National Weather Service: ${n(s.counts.tornado, "tornado report", "tornado reports")}, ${n(s.counts.wind, "damaging wind report", "damaging wind reports")} and ${n(s.counts.hail, "large hail report", "large hail reports")}${where}.`,
    highlights.join(" "),
    "These are preliminary local storm reports from trained spotters, emergency managers and the public, via the Iowa Environmental Mesonet. Totals change as reports are reviewed.",
    LINK_LINE,
    DISCLAIMER,
    "#weather #severeweather #stormreports #tornado #shorts",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function recapEs(s: RecapSummary, day: number): { title: string; description: string } {
  const parts = [
    s.counts.tornado ? n(s.counts.tornado, "reporte de tornado", "reportes de tornado") : null,
    s.hail?.magnitude ? `granizo de hasta ${Math.round(s.hail.magnitude * 2.54)} cm` : null,
  ].filter((p): p is string => !!p);
  const base = `Reportes de clima severo, ${shortDayEs(day)}`;
  const where = s.states.length ? `, sobre todo en ${list(s.states, "y")}` : "";
  const highlights = [
    s.hail?.magnitude ? `Granizo más grande: ${inches(s.hail.magnitude)} (${Math.round(s.hail.magnitude * 2.54)} cm) cerca de ${s.hail.place}.` : null,
    s.wind?.magnitude ? `Ráfaga más fuerte: ${Math.round(s.wind.magnitude)} mph (${Math.round(s.wind.magnitude * 1.609)} km/h) cerca de ${s.wind.place}.` : null,
  ].filter(Boolean);
  return {
    title: fitTitle(`${base}: ${parts.join(", ") || n(s.total, "reporte", "reportes")} #shorts`, `${base}: ${parts[0] ?? n(s.total, "reporte", "reportes")} #shorts`, `${base} #shorts`),
    description: [
      `Reportes de clima severo de hoy, ${longDayEs(day)}, del Servicio Meteorológico Nacional: ${n(s.counts.tornado, "reporte de tornado", "reportes de tornado")}, ${n(s.counts.wind, "reporte de vientos dañinos", "reportes de vientos dañinos")} y ${n(s.counts.hail, "reporte de granizo grande", "reportes de granizo grande")}${where}.`,
      highlights.join(" "),
      "Son reportes preliminares de observadores entrenados, autoridades de emergencia y el público, vía el Iowa Environmental Mesonet. Las cifras pueden cambiar al revisarse.",
      LINK_LINE_ES,
      DISCLAIMER_ES,
      "#clima #tormentas #tornado #shorts",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, "");

/** The convective day being recapped: it starts at 12Z (7 AM Central) on the day `now - 12 h` falls on. */
export const dayStart = (now: number) => Date.parse(`${new Date(now - 12 * 3_600_000).toISOString().slice(0, 10)}T12:00:00Z`);

export const recapKind: Kind = async (ctx) => {
  const now = Date.now();
  const raw = await getJson<unknown>(ctx, "lsr.geojson", `${IEM_LSR}?sts=${stamp(dayStart(now))}&ets=${stamp(now)}`);
  const reports = severeReports(parseLsrGeoJson(raw));
  const s = summarize(reports);
  console.log(`Storm reports: ${s.counts.tornado} tornado, ${s.counts.wind} wind, ${s.counts.hail} hail (${s.total} severe).`);
  if (!isActive(s) && ctx.env.SHORTS_LATEST !== "1") {
    console.log(`Not an active day (no tornado reports and under ${ACTIVE_TOTAL} severe reports); no video.`);
    return [];
  }
  if (!reports.length) return [];
  const day = ctx.fixtures ? dayStart(reports.at(-1)!.time) : dayStart(now);
  const highlight = (r: RecapReport | null, label: string, value: string) => (r ? { label, value, place: r.place, lat: r.lat, lon: r.lon, kind: r.kind } : null);
  return [
    {
      key: "recap",
      template: "recap.html",
      title: recapTitle(s, day),
      description: recapDescription(s),
      tags: ["severe weather", "storm reports", "tornado", "hail", "weather", "Storm Central", ...s.states],
      es: recapEs(s, day),
      playlist: "Storm Reports",
      data: {
        states: readVendor("states-10m.json"),
        date: new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" }).format(day),
        reports: reports.map((r) => ({ k: r.kind, t: r.time, lat: r.lat, lon: r.lon, big: (r.kind === "hail" && (r.magnitude ?? 0) >= 2) || (r.kind === "wind" && (r.magnitude ?? 0) >= 75) || r.kind === "tornado" })),
        counts: s.counts,
        highlights: [
          highlight(s.hail, "Largest hail", s.hail?.magnitude ? inches(s.hail.magnitude) : ""),
          highlight(s.wind, "Strongest gust", s.wind?.magnitude ? `${Math.round(s.wind.magnitude)} mph` : ""),
          s.counts.tornado ? { label: "Tornado reports", value: String(s.counts.tornado), place: list(s.tornadoStates), lat: null, lon: null, kind: "tornado" } : null,
        ].filter(Boolean),
      },
    },
  ];
};
