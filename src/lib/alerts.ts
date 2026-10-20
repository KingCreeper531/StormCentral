/**
 * NWS CAP alert normalisation: hazard colours (NWS standard), impact tags
 * (PDS / emergency / observed / destructive) and a severity rank used for
 * sorting and z-ordering polygons.
 */
import type { WeatherAlert } from "./api/types";
import type { PolygonalGeometry } from "./geo";
import { parseEventMotion } from "./science/storm-motion";

/**
 * NWS hazard map colours (weather.gov's watch/warning/advisory legend) for
 * every product the WWA map can carry. Unlisted events fall back by type.
 */
export const HAZARD_COLORS: Record<string, string> = {
  "Tsunami Warning": "#fd6347",
  "Tornado Warning": "#ff0000",
  "Extreme Wind Warning": "#ff8c00",
  "Severe Thunderstorm Warning": "#ffa500",
  "Flash Flood Warning": "#8b0000",
  "Flash Flood Statement": "#8b0000",
  "Severe Weather Statement": "#00ffff",
  "Shelter In Place Warning": "#fa8072",
  "Evacuation Immediate": "#7fff00",
  "Civil Danger Warning": "#ffb6c1",
  "Nuclear Power Plant Warning": "#4b0082",
  "Radiological Hazard Warning": "#4b0082",
  "Hazardous Materials Warning": "#4b0082",
  "Fire Warning": "#a0522d",
  "Civil Emergency Message": "#ffb6c1",
  "Law Enforcement Warning": "#c0c0c0",
  "Storm Surge Warning": "#b524f7",
  "Hurricane Force Wind Warning": "#cd5c5c",
  "Hurricane Warning": "#dc143c",
  "Typhoon Warning": "#dc143c",
  "Special Marine Warning": "#ffa500",
  "Blizzard Warning": "#ff4500",
  "Snow Squall Warning": "#c71585",
  "Ice Storm Warning": "#8b008b",
  "Heavy Freezing Spray Warning": "#00bfff",
  "Winter Storm Warning": "#ff69b4",
  "Lake Effect Snow Warning": "#008b8b",
  "Dust Storm Warning": "#ffe4c4",
  "Blowing Dust Warning": "#ffe4c4",
  "High Wind Warning": "#daa520",
  "Tropical Storm Warning": "#b22222",
  "Storm Warning": "#9400d3",
  "Tsunami Advisory": "#d2691e",
  "Tsunami Watch": "#ff00ff",
  "Avalanche Warning": "#1e90ff",
  "Earthquake Warning": "#8b4513",
  "Volcano Warning": "#2f4f4f",
  "Ashfall Warning": "#a9a9a9",
  "Flood Warning": "#00ff00",
  "Coastal Flood Warning": "#228b22",
  "Lakeshore Flood Warning": "#228b22",
  "Ashfall Advisory": "#696969",
  "High Surf Warning": "#228b22",
  "Extreme Heat Warning": "#c71585",
  "Excessive Heat Warning": "#c71585",
  "Tornado Watch": "#ffff00",
  "Severe Thunderstorm Watch": "#db7093",
  "Flash Flood Watch": "#2e8b57",
  "Gale Warning": "#dda0dd",
  "Flood Statement": "#00ff00",
  "Extreme Cold Warning": "#0000ff",
  "Wind Chill Warning": "#b0c4de",
  "Freeze Warning": "#483d8b",
  "Hard Freeze Warning": "#9400d3",
  "Red Flag Warning": "#ff1493",
  "Storm Surge Watch": "#db7ff7",
  "Hurricane Watch": "#ff00ff",
  "Hurricane Force Wind Watch": "#9932cc",
  "Typhoon Watch": "#ff00ff",
  "Tropical Storm Watch": "#f08080",
  "Storm Watch": "#ffe4b5",
  "Hurricane Local Statement": "#ffe4b5",
  "Typhoon Local Statement": "#ffe4b5",
  "Tropical Cyclone Local Statement": "#ffe4b5",
  "Winter Weather Advisory": "#7b68ee",
  "Avalanche Advisory": "#cd853f",
  "Cold Weather Advisory": "#afeeee",
  "Wind Chill Advisory": "#afeeee",
  "Heat Advisory": "#ff7f50",
  "Flood Advisory": "#00ff7f",
  "Coastal Flood Advisory": "#7cfc00",
  "Lakeshore Flood Advisory": "#7cfc00",
  "High Surf Advisory": "#ba55d3",
  "Heavy Freezing Spray Watch": "#bc8f8f",
  "Dense Fog Advisory": "#708090",
  "Dense Smoke Advisory": "#f0e68c",
  "Small Craft Advisory": "#d8bfd8",
  "Brisk Wind Advisory": "#d8bfd8",
  "Hazardous Seas Warning": "#d8bfd8",
  "Dust Advisory": "#bdb76b",
  "Blowing Dust Advisory": "#bdb76b",
  "Lake Wind Advisory": "#d2b48c",
  "Wind Advisory": "#d2b48c",
  "Frost Advisory": "#6495ed",
  "Freezing Fog Advisory": "#008080",
  "Freezing Spray Advisory": "#00bfff",
  "Low Water Advisory": "#a52a2a",
  "Local Area Emergency": "#c0c0c0",
  "Winter Storm Watch": "#4682b4",
  "Rip Current Statement": "#40e0d0",
  "Beach Hazards Statement": "#40e0d0",
  "Gale Watch": "#ffc0cb",
  "Avalanche Watch": "#f4a460",
  "Hazardous Seas Watch": "#483d8b",
  "Flood Watch": "#2e8b57",
  "Coastal Flood Watch": "#66cdaa",
  "Lakeshore Flood Watch": "#66cdaa",
  "High Wind Watch": "#b8860b",
  "Extreme Heat Watch": "#800000",
  "Excessive Heat Watch": "#800000",
  "Extreme Cold Watch": "#5f9ea0",
  "Wind Chill Watch": "#5f9ea0",
  "Freeze Watch": "#00ffff",
  "Hard Freeze Watch": "#4169e1",
  "Fire Weather Watch": "#ffdead",
  "Extreme Fire Danger": "#e9967a",
  "911 Telephone Outage": "#c0c0c0",
  "Coastal Flood Statement": "#6b8e23",
  "Lakeshore Flood Statement": "#6b8e23",
  "Special Weather Statement": "#ffe4b5",
  "Marine Weather Statement": "#ffdab9",
  "Air Quality Alert": "#808080",
  "Air Stagnation Advisory": "#808080",
  "Hazardous Weather Outlook": "#eee8aa",
  "Hydrologic Outlook": "#90ee90",
  "Short Term Forecast": "#98fb98",
  "Child Abduction Emergency": "#ffffff",
  "Blue Alert": "#ffffff",
  // SPC / WPC mesoscale discussions (SPC draws MDs in blue, WPC MPDs in green).
  "Mesoscale Discussion": "#2f6bff",
  "Mesoscale Precipitation Discussion": "#22a34a",
};

/**
 * What kind of product an alert is, for filtering the map. Marine-zone
 * products get their own group so a coast full of small craft advisories
 * can be hidden without losing the advisories over land.
 */
export const ALERT_CATEGORIES = ["warning", "watch", "advisory", "statement", "marine", "discussion"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

const MARINE_EVENTS = new Set([
  "Small Craft Advisory",
  "Gale Warning",
  "Gale Watch",
  "Storm Warning",
  "Storm Watch",
  "Hurricane Force Wind Warning",
  "Hurricane Force Wind Watch",
  "Hazardous Seas Warning",
  "Hazardous Seas Watch",
  "Brisk Wind Advisory",
  "Heavy Freezing Spray Warning",
  "Heavy Freezing Spray Watch",
  "Freezing Spray Advisory",
  "Marine Weather Statement",
  "Low Water Advisory",
]);

export function alertCategory(event: string): AlertCategory {
  if (/Discussion$/.test(event)) return "discussion";
  if (MARINE_EVENTS.has(event)) return "marine";
  if (/Warning$|Emergency$|Evacuation Immediate/.test(event)) return "warning";
  if (/Watch$/.test(event)) return "watch";
  if (/Advisory$|Air Quality Alert|Extreme Fire Danger/.test(event)) return "advisory";
  return "statement";
}

/** Fallback colour by category for events missing from HAZARD_COLORS (and other countries' products). */
export const CATEGORY_COLORS: Record<AlertCategory, string> = {
  warning: "#e5484d",
  watch: "#f5c518",
  advisory: "#a78bfa",
  statement: "#ffe4b5",
  marine: "#d8bfd8",
  discussion: "#2f6bff",
};

export const hazardColor = (event: string) => HAZARD_COLORS[event] ?? CATEGORY_COLORS[alertCategory(event)];

/**
 * Display labels for the impact tags `normalizeAlert` emits as NWS constants
 * (kept as constants in data so tests and logic can match on them).
 */
export const TAG_LABEL: Record<string, string> = {
  PDS: "PDS",
  OBSERVED: "Tornado observed",
  "TORNADO POSSIBLE": "Tornado possible",
  CONSIDERABLE: "Considerable",
  DESTRUCTIVE: "Destructive",
  "TORNADO EMERGENCY": "Tornado emergency",
  "FLASH FLOOD EMERGENCY": "Flash flood emergency",
};

export const tagLabel = (tag: string) => TAG_LABEL[tag] ?? tag;

/** Storm-based (polygon) products worth drawing on the national map. */
export const POLYGON_EVENTS = [
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Flash Flood Warning",
  "Extreme Wind Warning",
  "Snow Squall Warning",
  "Special Marine Warning",
  "Dust Storm Warning",
  "Special Weather Statement",
] as const;

const BASE_RANK: Record<string, number> = {
  "Tornado Warning": 90,
  "Extreme Wind Warning": 85,
  "Flash Flood Warning": 70,
  "Severe Thunderstorm Warning": 65,
  "Hurricane Warning": 80,
  "Storm Surge Warning": 78,
  "Snow Squall Warning": 60,
  "Blizzard Warning": 58,
  "Tornado Watch": 55,
  "Severe Thunderstorm Watch": 50,
  "Special Marine Warning": 45,
  "Dust Storm Warning": 45,
  "Ice Storm Warning": 44,
  "Winter Storm Warning": 42,
  "Extreme Heat Warning": 40,
  "Excessive Heat Warning": 40,
  "Flood Warning": 38,
  "High Wind Warning": 36,
  "Red Flag Warning": 34,
  "Special Weather Statement": 20,
  "Tsunami Warning": 88,
  "Mesoscale Discussion": 30,
  "Mesoscale Precipitation Discussion": 26,
};

/** Rank for events without their own: warnings over watches over advisories. */
const CATEGORY_RANK: Record<AlertCategory, number> = { warning: 32, watch: 24, advisory: 14, statement: 8, marine: 6, discussion: 28 };

export const baseRank = (event: string) => BASE_RANK[event] ?? CATEGORY_RANK[alertCategory(event)];

const SEVERITY_RANK: Record<string, number> = { Extreme: 30, Severe: 20, Moderate: 10, Minor: 5 };

interface RawAlertFeature {
  id?: string;
  geometry: PolygonalGeometry | { type: string } | null;
  properties: {
    id: string;
    event: string;
    headline?: string | null;
    severity?: string;
    urgency?: string;
    certainty?: string;
    sent: string;
    effective: string;
    expires: string;
    ends?: string | null;
    areaDesc?: string;
    senderName?: string;
    description?: string | null;
    instruction?: string | null;
    messageType?: string;
    parameters?: Record<string, string[] | undefined>;
  };
}

const first = (p: Record<string, string[] | undefined> | undefined, k: string) => p?.[k]?.[0];

/** A warning's impact-based tags (damage threat, tornado detection), however they were sent. */
export interface ImpactTags {
  event: string;
  tornadoThreat?: string | null;
  tstmThreat?: string | null;
  ffThreat?: string | null;
  tornadoDetection?: string | null;
  tornadoEmergency?: boolean;
  ffEmergency?: boolean;
  pds?: boolean;
}

/** The tags a warning shows (TORNADO EMERGENCY, PDS, OBSERVED…) and the rank they add. */
export function impactTags(w: ImpactTags): { tags: string[]; bonus: number } {
  const tags: string[] = [];
  if (w.tornadoThreat === "CATASTROPHIC" || w.tornadoEmergency) tags.push("TORNADO EMERGENCY");
  else if (w.tornadoThreat === "CONSIDERABLE" || w.pds) tags.push("PDS");
  if (w.ffThreat === "CATASTROPHIC" || w.ffEmergency) tags.push("FLASH FLOOD EMERGENCY");
  else if (w.ffThreat === "CONSIDERABLE") tags.push("CONSIDERABLE");
  if (w.tornadoDetection === "OBSERVED") tags.push("OBSERVED");
  else if (w.tornadoDetection === "POSSIBLE" && w.event === "Severe Thunderstorm Warning") tags.push("TORNADO POSSIBLE");
  if (w.tstmThreat === "DESTRUCTIVE") tags.push("DESTRUCTIVE");
  else if (w.tstmThreat === "CONSIDERABLE") tags.push("CONSIDERABLE");

  let bonus = 0;
  if (tags.includes("TORNADO EMERGENCY") || tags.includes("FLASH FLOOD EMERGENCY")) bonus += 60;
  else if (tags.includes("PDS") || tags.includes("DESTRUCTIVE")) bonus += 25;
  if (tags.includes("OBSERVED")) bonus += 10;
  return { tags, bonus };
}

export function normalizeAlert(f: RawAlertFeature): WeatherAlert {
  const p = f.properties;
  const params = p.parameters;
  const tornadoDetection = first(params, "tornadoDetection");
  const tornadoThreat = first(params, "tornadoDamageThreat");
  const tstmThreat = first(params, "thunderstormDamageThreat");
  const ffThreat = first(params, "flashFloodDamageThreat");
  const description = p.description ?? "";
  const { tags, bonus } = impactTags({
    event: p.event,
    tornadoThreat,
    tstmThreat,
    ffThreat,
    tornadoDetection,
    tornadoEmergency: /TORNADO EMERGENCY/i.test(description),
    ffEmergency: /FLASH FLOOD EMERGENCY/i.test(description),
    pds: /PARTICULARLY DANGEROUS SITUATION/i.test(description),
  });
  const rank = baseRank(p.event) + (SEVERITY_RANK[p.severity ?? ""] ?? 0) + bonus;

  const geometry =
    f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      ? (f.geometry as PolygonalGeometry)
      : null;

  return {
    id: p.id ?? f.id ?? `${p.event}-${p.sent}`,
    event: p.event,
    headline: first(params, "NWSheadline") ?? p.headline ?? null,
    severity: p.severity ?? "Unknown",
    urgency: p.urgency ?? "Unknown",
    certainty: p.certainty ?? "Unknown",
    sent: p.sent,
    effective: p.effective,
    expires: p.expires,
    ends: p.ends ?? null,
    areaDesc: p.areaDesc ?? "",
    sender: p.senderName ?? "National Weather Service",
    description,
    instruction: p.instruction ?? null,
    hazards: {
      maxHail: first(params, "maxHailSize"),
      maxWind: first(params, "maxWindGust"),
      tornado: tornadoDetection,
      damageThreat: tornadoThreat ?? tstmThreat ?? ffThreat,
    },
    tags,
    color: hazardColor(p.event),
    rank,
    motion: parseEventMotion(first(params, "eventMotionDescription")),
    geometry,
  };
}

export function normalizeAlerts(features: RawAlertFeature[], now = Date.now()): WeatherAlert[] {
  return features
    .filter((f) => f?.properties?.event && Date.parse(f.properties.ends ?? f.properties.expires) > now)
    .map(normalizeAlert)
    .sort((a, b) => b.rank - a.rank || Date.parse(b.sent) - Date.parse(a.sent));
}

export type { RawAlertFeature };

/**
 * Hazard-map polygons to draw next to the storm-based warnings: the kinds the
 * user picked, other countries' only when wanted, and nothing the warnings
 * feed already has (it carries the full text).
 */
export function visibleHazards(hazards: readonly WeatherAlert[], warnings: readonly WeatherAlert[], kinds: readonly AlertCategory[], intl: boolean): WeatherAlert[] {
  const have = new Set(warnings.map((a) => a.id));
  const want = new Set(kinds);
  return hazards.filter(
    (a) => a.geometry && !have.has(a.id) && want.has(a.category ?? alertCategory(a.event)) && (intl || (a.source !== "eccc" && a.source !== "dwd")),
  );
}
