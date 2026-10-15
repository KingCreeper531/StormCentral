/**
 * The week ahead (Sundays): SPC's outlooks for the next eight days, the
 * categorical risk for days 1-3 and the 15% / 30% severe probabilities for
 * days 4-8, day by day, then the most active day.
 */
import { DISCLAIMER, DISCLAIMER_ES, drawable, fitTitle, LINK_LINE, LINK_LINE_ES, RISK_ES, type GeoCollection } from "../meta";
import { RISKS, type Risk } from "../spc-outlook";
import { getJson, readVendor } from "../source";
import type { Kind } from "../video";

const SPC = "https://www.spc.noaa.gov/products";
const CAT_LEVEL: Record<string, number> = { MRGL: 1, SLGT: 2, ENH: 3, MDT: 4, HIGH: 5 };
const CODE_RISK: Record<string, Risk> = { MRGL: "MARGINAL", SLGT: "SLIGHT", ENH: "ENHANCED", MDT: "MODERATE", HIGH: "HIGH" };

export interface WeekDay {
  /** Epoch ms of 12Z on the day (the outlook period's start). */
  date: number;
  /** Day 1-8. */
  n: number;
  /** Days 1-3: the highest categorical risk ("SLGT"), null for none. Days 4-8: null. */
  code: string | null;
  /** Days 4-8: the highest severe probability (15 or 30), 0 for none. Days 1-3: 0. */
  prob: number;
  /** 0-5, for colouring (days 4-8: 15% reads as 2, 30% as 3). */
  level: number;
  features: GeoCollection;
}

/** "202610171200" → epoch ms. */
const validMs = (v: string | undefined) => (v && /^\d{12}$/.test(v) ? Date.parse(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}:00Z`) : NaN);
/** The calendar day an outlook covers: its 12Z start (day 1's VALID can be a later update). */
const dayOf = (fc: GeoCollection, fallback: number) => {
  const ms = validMs(fc.features.find((f) => f.properties.VALID)?.properties.VALID);
  return Number.isFinite(ms) ? Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T12:00:00Z`) : fallback;
};

export function catDay(fc: GeoCollection, n: number, fallback: number): WeekDay {
  const shapes = drawable(fc);
  const level = Math.max(0, ...shapes.features.map((f) => CAT_LEVEL[f.properties.LABEL ?? ""] ?? 0));
  const code = Object.keys(CAT_LEVEL).find((k) => CAT_LEVEL[k] === level) ?? null;
  return { date: dayOf(fc, fallback), n, code, prob: 0, level, features: shapes };
}

export function probDay(fc: GeoCollection, n: number, fallback: number): WeekDay {
  // Areas carry "0.15" or "0.30"; "Potential Too Low" and "Predictability Too Low" mean none.
  const shapes: GeoCollection = { type: "FeatureCollection", features: drawable(fc).features.filter((f) => Number.isFinite(parseFloat(f.properties.LABEL ?? ""))) };
  const prob = Math.round(Math.max(0, ...shapes.features.map((f) => parseFloat(f.properties.LABEL ?? "0") * (parseFloat(f.properties.LABEL ?? "0") <= 1 ? 100 : 1))));
  return { date: dayOf(fc, fallback), n, code: null, prob, level: prob >= 30 ? 3 : prob >= 15 ? 2 : 0, features: shapes };
}

const weekday = (ms: number, locale: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(ms);
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function dayRisk(d: WeekDay, lang: "en" | "es" = "en"): string {
  if (d.code) {
    const risk = CODE_RISK[d.code]!;
    return lang === "es" ? `${RISK_ES[risk]} (${RISKS.indexOf(risk) + 1} de 5)` : `${titleCase(risk)} Risk (${RISKS.indexOf(risk) + 1} of 5)`;
  }
  if (d.prob) return lang === "es" ? `${d.prob}% de probabilidad de tormentas severas` : `${d.prob}% chance of severe storms`;
  return lang === "es" ? (d.n <= 3 ? "Sin riesgo de tormentas severas" : "Probabilidad baja") : d.n <= 3 ? "No severe risk" : "Low chance";
}

/** The most active day: highest level, then the earliest. */
export const busiest = (days: WeekDay[]) => days.reduce<WeekDay | null>((best, d) => (d.level > (best?.level ?? 0) ? d : best), null);

export function weeklyText(days: WeekDay[]) {
  const first = days[0]!.date, last = days.at(-1)!.date;
  const range = (locale: string) => `${weekday(first, locale, { month: "short", day: "numeric" })} – ${weekday(last, locale, { month: "short", day: "numeric" })}`;
  const top = busiest(days);
  const topEn = top ? `${dayRisk(top).replace(/ \(\d of 5\)/, "")} ${weekday(top.date, "en-US", { weekday: "long" })}` : "Quiet Week Ahead";
  const topEs = top ? `${dayRisk(top, "es").replace(/ \(\d de 5\)/, "").toLowerCase()} el ${weekday(top.date, "es-MX", { weekday: "long" })}` : "semana tranquila";
  const lines = (lang: "en" | "es") =>
    days.map((d) => `${weekday(d.date, lang === "es" ? "es-MX" : "en-US", { weekday: "short", month: "short", day: "numeric" })}: ${dayRisk(d, lang)}`).join("\n");
  return {
    title: fitTitle(`Severe Weather Week Ahead, ${range("en-US")}: ${topEn} #shorts`, `Severe Weather Week Ahead: ${topEn} #shorts`),
    description: [
      `The severe weather outlook for the next eight days from NOAA's Storm Prediction Center (days 1-3: the risk level; days 4-8: the chance of severe storms within 25 miles of a point).`,
      lines("en"),
      LINK_LINE,
      DISCLAIMER,
      "#weather #severeweather #forecast #shorts",
    ].join("\n\n"),
    es: {
      title: fitTitle(`Tormentas severas, la semana (${range("es-MX")}): ${topEs} #shorts`, `Tormentas severas, la semana: ${topEs} #shorts`),
      description: [
        "El pronóstico de tormentas severas para los próximos ocho días, del Centro de Predicción de Tormentas (SPC) de la NOAA (días 1 a 3: el nivel de riesgo; días 4 a 8: la probabilidad de tormentas severas a menos de 40 km de un punto).",
        lines("es"),
        LINK_LINE_ES,
        DISCLAIMER_ES,
        "#clima #tormentas #pronóstico #shorts",
      ].join("\n\n"),
    },
  };
}

export const weeklyKind: Kind = async (ctx) => {
  const now = Date.now();
  const day1 = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T12:00:00Z`);
  const days: WeekDay[] = [];
  for (let n = 1; n <= 8; n++) {
    const fallback = day1 + (n - 1) * 86_400_000;
    if (n <= 3) days.push(catDay(await getJson<GeoCollection>(ctx, `day${n}_cat.geojson`, `${SPC}/outlook/day${n}otlk_cat.lyr.geojson`), n, fallback));
    else days.push(probDay(await getJson<GeoCollection>(ctx, `day${n}_prob.geojson`, `${SPC}/exper/day4-8/day${n}prob.lyr.geojson`), n, fallback));
  }
  console.log(`Week ahead: ${days.map((d) => `D${d.n} ${d.code ?? (d.prob ? `${d.prob}%` : "-")}`).join(", ")}.`);
  const text = weeklyText(days);
  const label = (d: WeekDay) => weekday(d.date, "en-US", { weekday: "short", month: "short", day: "numeric" });
  return [
    {
      key: "weekly",
      template: "weekly.html",
      ...text,
      tags: ["severe weather", "weather forecast", "storm prediction center", "week ahead", "tornado", "Storm Central"],
      playlist: "Severe Weather: Week Ahead",
      data: {
        states: readVendor("states-10m.json"),
        range: `${weekday(days[0]!.date, "en-US", { month: "short", day: "numeric" })} – ${weekday(days.at(-1)!.date, "en-US", { month: "short", day: "numeric" })}`,
        days: days.map((d) => ({ label: label(d), short: weekday(d.date, "en-US", { weekday: "short" }), n: d.n, code: d.code, prob: d.prob, level: d.level, risk: dayRisk(d), features: d.features })),
      },
    },
  ];
};
