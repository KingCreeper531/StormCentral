/**
 * What the Shorts say: shared text (link, disclaimer, dates in English and
 * Spanish) and the daily outlook's risk, region, hazards, title, description
 * and tags. Pure functions, tested in meta.test.ts.
 */
import { RISKS, type Outlook, type Risk } from "../bot/outlook";

export const SITE = "https://www.stormcentralwx.com";
/** SPC's GeoJSON labels for each categorical risk. */
export const RISK_CODES: Record<Risk, string> = { MARGINAL: "MRGL", SLIGHT: "SLGT", ENHANCED: "ENH", MODERATE: "MDT", HIGH: "HIGH" };

export interface GeoFeature {
  type: "Feature";
  geometry: unknown;
  properties: { LABEL?: string; VALID?: string; ISSUE?: string; fill?: string; stroke?: string };
}
export interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface Hazards {
  tornado: number;
  wind: number;
  hail: number;
}

/** The highest probability (percent) in a hazard's outlook; 0 when there is none. */
export function maxProbability(fc: GeoCollection | null): number {
  const ps = (fc?.features ?? []).map((f) => Number(f.properties.LABEL)).filter((p) => Number.isFinite(p) && p > 0 && p < 1);
  return ps.length ? Math.round(Math.max(...ps) * 100) : 0;
}

/** Only the features with a shape and a label (SPC's files carry empty placeholders). */
export const drawable = (fc: GeoCollection | null): GeoCollection => ({
  type: "FeatureCollection",
  features: (fc?.features ?? []).filter((f) => f.geometry && f.properties.LABEL),
});

const titleWord = (w: string) => w.charAt(0) + w.slice(1).toLowerCase();
const SMALL = new Set(["and", "of", "the", "into", "to", "from", "across", "in"]);

/**
 * Where the highest risk is, from the headline: "...THERE IS A SLIGHT RISK OF
 * SEVERE THUNDERSTORMS ACROSS THE SOUTHERN PLAINS..." → "Southern Plains".
 */
export function regionOf(productText: string): string {
  const text = productText.replace(/\s+/g, " ");
  const m = /THERE IS AN? (?:MARGINAL|SLIGHT|ENHANCED|MODERATE|HIGH) RISK OF SEVERE THUNDERSTORMS (?:ACROSS|OVER|FOR|IN) (.*?)\.\.\./.exec(text);
  if (!m) return "";
  const words = m[1]!.replace(/^(?:PORTIONS|PARTS) OF\s+/, "").replace(/^THE\s+/, "").trim().split(" ");
  const region = words.map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : titleWord(w))).join(" ");
  return region.length <= 48 ? region : "";
}

/** "Wednesday, October 14" for the outlook's day (Central time, SPC's own). */
export const outlookDay = (issued: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" }).format(issued);
const shortDay = (issued: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" }).format(issued);

const riskName = (o: Outlook) => (o.risk ? `${titleWord(o.risk)} Risk` : "No Severe Risk");

/** "Severe Weather Outlook, Wed, Oct 14: Slight Risk for the Southern Plains #shorts" (YouTube's limit is 100). */
export function titleFor(o: Outlook, region: string, issued: number): string {
  const base = `Severe Weather Outlook, ${shortDay(issued)}: ${riskName(o)}`;
  const withRegion = region && o.risk ? `${base} for the ${region} #shorts` : `${base} #shorts`;
  return withRegion.length <= 100 ? withRegion : `${base} #shorts`;
}

const hazardWord = (p: number) => `${p}%`;

// ─── Shared ────────────────────────────────────────────────────────────────

export const DISCLAIMER = "Storm Central is not an official warning system. Always follow the National Weather Service and your local emergency management.";
export const DISCLAIMER_ES =
  "Storm Central no es un sistema oficial de alertas. Sigue siempre las indicaciones del Servicio Meteorológico Nacional y de las autoridades de protección civil de tu localidad.";
export const LINK_LINE = `Get severe weather alerts for your location, free: ${SITE}`;
export const LINK_LINE_ES = `Recibe alertas de clima severo para tu ubicación, gratis: ${SITE}`;

const fmt = (locale: string, opts: Intl.DateTimeFormatOptions) => (ms: number, timeZone = "America/Chicago") => new Intl.DateTimeFormat(locale, { timeZone, ...opts }).format(ms);
/** "mié, 14 de oct", "miércoles, 14 de octubre": Spanish (Mexico) dates, Central time unless given. */
export const shortDayEs = fmt("es-MX", { weekday: "short", month: "short", day: "numeric" });
export const longDayEs = fmt("es-MX", { weekday: "long", month: "long", day: "numeric" });
export const shortDayEn = fmt("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Titles stay within YouTube's 100 characters: the longest that fits, else the last resort. */
export const fitTitle = (...options: string[]) => options.find((o) => o.length <= 100) ?? options.at(-1)!.slice(0, 100);

/** SPC's categorical risks in Spanish, as the app names them. */
export const RISK_ES: Record<Risk, string> = { MARGINAL: "Riesgo marginal", SLIGHT: "Riesgo ligero", ENHANCED: "Riesgo mejorado", MODERATE: "Riesgo moderado", HIGH: "Riesgo alto" };

export function titleForEs(o: Outlook, issued: number): string {
  const risk = o.risk ? `${RISK_ES[o.risk]} (nivel ${RISKS.indexOf(o.risk) + 1} de 5)` : "Sin riesgo de tormentas severas";
  return fitTitle(`Pronóstico de tormentas severas, ${shortDayEs(issued)}: ${risk} #shorts`, `Tormentas severas, ${shortDayEs(issued)}: ${risk}`);
}

export function descriptionForEs(o: Outlook, region: string, h: Hazards): string {
  const lead = o.risk
    ? `Pronóstico de tormentas severas de hoy, del Centro de Predicción de Tormentas (SPC) de la NOAA: ${RISK_ES[o.risk]} (nivel ${RISKS.indexOf(o.risk) + 1} de 5)${region ? `, en la región ${region}` : ""}.`
    : "Pronóstico de tormentas severas de hoy, del Centro de Predicción de Tormentas (SPC) de la NOAA: no se pronostican tormentas severas.";
  return [
    lead,
    `Tornado ${h.tornado}%, vientos dañinos ${h.wind}%, granizo grande ${h.hail}% (la probabilidad a menos de 40 km de un punto).`,
    LINK_LINE_ES,
    DISCLAIMER_ES,
    "#clima #tormentas #tornado #shorts",
  ].join("\n\n");
}

export function descriptionFor(o: Outlook, region: string, h: Hazards): string {
  const level = o.risk ? RISKS.indexOf(o.risk) + 1 : 0;
  const lead = o.risk
    ? `Today's severe weather outlook from NOAA's Storm Prediction Center: ${riskName(o)} (level ${level} of 5)${region ? ` for the ${region}` : ""}.`
    : "Today's severe weather outlook from NOAA's Storm Prediction Center: no severe thunderstorms are forecast.";
  return [
    lead,
    o.summary,
    `Tornado ${hazardWord(h.tornado)}, damaging wind ${hazardWord(h.wind)}, large hail ${hazardWord(h.hail)} (the chance within 25 miles of a point).`,
    LINK_LINE,
    DISCLAIMER,
    "#weather #severeweather #tornado #shorts",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function tagsFor(o: Outlook, region: string): string[] {
  return ["severe weather", "weather outlook", "storm prediction center", "tornado", "weather forecast", "Storm Central", ...(o.risk ? [`${titleWord(o.risk)} Risk`.toLowerCase()] : []), ...(region ? [region] : [])];
}
