/**
 * NWS CAP alert normalisation: hazard colours (NWS standard), impact tags
 * (PDS / emergency / observed / destructive) and a severity rank used for
 * sorting and z-ordering polygons.
 */
import type { WeatherAlert } from "./api/types";
import type { PolygonalGeometry } from "./geo";
import { parseEventMotion } from "./science/storm-motion";

export const HAZARD_COLORS: Record<string, string> = {
  "Tornado Warning": "#ff0000",
  "Extreme Wind Warning": "#ff8c00",
  "Severe Thunderstorm Warning": "#ffa500",
  "Flash Flood Warning": "#8b0000",
  "Snow Squall Warning": "#c71585",
  "Special Marine Warning": "#ffa500",
  "Dust Storm Warning": "#ffe4c4",
  "Special Weather Statement": "#ffe4b5",
  "Tornado Watch": "#ffff00",
  "Severe Thunderstorm Watch": "#db7093",
  "Flash Flood Watch": "#2e8b57",
  "Flood Warning": "#00ff00",
  "Flood Advisory": "#00ff7f",
  "Hurricane Warning": "#dc143c",
  "Tropical Storm Warning": "#b22222",
  "Storm Surge Warning": "#b524f7",
  "Blizzard Warning": "#ff4500",
  "Winter Storm Warning": "#ff69b4",
  "Ice Storm Warning": "#8b008b",
  "Winter Weather Advisory": "#7b68ee",
  "Extreme Heat Warning": "#c71585",
  "Excessive Heat Warning": "#c71585",
  "Heat Advisory": "#ff7f50",
  "High Wind Warning": "#daa520",
  "Wind Advisory": "#d2b48c",
  "Red Flag Warning": "#ff1493",
  "Dense Fog Advisory": "#708090",
  "Freeze Warning": "#483d8b",
  "Frost Advisory": "#6495ed",
  "Air Quality Alert": "#808080",
};

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
};

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

export function normalizeAlert(f: RawAlertFeature): WeatherAlert {
  const p = f.properties;
  const params = p.parameters;
  const tornadoDetection = first(params, "tornadoDetection");
  const tornadoThreat = first(params, "tornadoDamageThreat");
  const tstmThreat = first(params, "thunderstormDamageThreat");
  const ffThreat = first(params, "flashFloodDamageThreat");
  const description = p.description ?? "";

  const tags: string[] = [];
  if (tornadoThreat === "CATASTROPHIC" || /TORNADO EMERGENCY/i.test(description)) tags.push("TORNADO EMERGENCY");
  else if (tornadoThreat === "CONSIDERABLE" || /PARTICULARLY DANGEROUS SITUATION/i.test(description)) tags.push("PDS");
  if (ffThreat === "CATASTROPHIC" || /FLASH FLOOD EMERGENCY/i.test(description)) tags.push("FLASH FLOOD EMERGENCY");
  else if (ffThreat === "CONSIDERABLE") tags.push("CONSIDERABLE");
  if (tornadoDetection === "OBSERVED") tags.push("OBSERVED");
  else if (tornadoDetection === "POSSIBLE" && p.event === "Severe Thunderstorm Warning") tags.push("TORNADO POSSIBLE");
  if (tstmThreat === "DESTRUCTIVE") tags.push("DESTRUCTIVE");
  else if (tstmThreat === "CONSIDERABLE") tags.push("CONSIDERABLE");

  let rank = (BASE_RANK[p.event] ?? 10) + (SEVERITY_RANK[p.severity ?? ""] ?? 0);
  if (tags.includes("TORNADO EMERGENCY") || tags.includes("FLASH FLOOD EMERGENCY")) rank += 60;
  else if (tags.includes("PDS") || tags.includes("DESTRUCTIVE")) rank += 25;
  if (tags.includes("OBSERVED")) rank += 10;

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
    color: HAZARD_COLORS[p.event] ?? "#9ca3af",
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
