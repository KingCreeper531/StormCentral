/**
 * What the daily outlook Short says, as data: the risk and where, the
 * hazards, the date, and the YouTube title, description and tags. Pure
 * functions, tested in meta.test.ts; main.ts fetches and render.ts draws.
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

export function descriptionFor(o: Outlook, region: string, h: Hazards): string {
  const level = o.risk ? RISKS.indexOf(o.risk) + 1 : 0;
  const lead = o.risk
    ? `Today's severe weather outlook from NOAA's Storm Prediction Center: ${riskName(o)} (level ${level} of 5)${region ? ` for the ${region}` : ""}.`
    : "Today's severe weather outlook from NOAA's Storm Prediction Center: no severe thunderstorms are forecast.";
  return [
    lead,
    o.summary,
    `Tornado ${hazardWord(h.tornado)}, damaging wind ${hazardWord(h.wind)}, large hail ${hazardWord(h.hail)} (the chance within 25 miles of a point).`,
    `Get severe weather alerts for your location, free: ${SITE}`,
    "Storm Central is not an official warning system. Always follow the National Weather Service and your local emergency management.",
    "#weather #severeweather #tornado #shorts",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function tagsFor(o: Outlook, region: string): string[] {
  return ["severe weather", "weather outlook", "storm prediction center", "tornado", "weather forecast", "Storm Central", ...(o.risk ? [`${titleWord(o.risk)} Risk`.toLowerCase()] : []), ...(region ? [region] : [])];
}
