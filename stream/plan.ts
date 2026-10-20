/**
 * What the 24/7 live stream shows and says (director.ts runs it): the active
 * warnings worth showing, the order of scenes, the announcement read when a
 * warning is issued, and the briefing read between them. Pure functions, no
 * browser or network, so they're tested on their own (plan.test.ts).
 *
 * Warnings are read in fixed sentences from the NWS's own facts, like the
 * breaking-news Shorts. The optional AI briefing only rephrases a template of
 * facts, and is thrown out for the template itself if it brings in a number
 * or a hazard that isn't in them.
 */
import { normalizeAlert, type RawAlertFeature } from "../src/lib/alerts";
import type { WeatherAlert } from "../src/lib/api/types";
import { clockText, parseAreas, placesText, placesTitle, situationOf, vtecOf, zoneFor, type Area } from "../shorts/kinds/breaking";

/** The products the stream follows, in the order they're shown when nothing else decides. */
export const EVENTS = ["Tornado Warning", "Extreme Wind Warning", "Severe Thunderstorm Warning", "Flash Flood Warning"] as const;
export type StreamEvent = (typeof EVENTS)[number];

export interface StreamWarning {
  /** One warning across its updates: office, product, number and year. */
  key: string;
  event: StreamEvent;
  /** "Tornado Emergency", "PDS Tornado Warning", "Tornado Warning"… */
  name: string;
  tags: string[];
  areas: Area[];
  ends: string;
  zone: string;
  /** Where the camera goes: the middle of the polygon. */
  lat: number;
  lon: number;
  situation: string | null;
  rank: number;
  sent: string;
  color: string;
}

/** The name to say and show: the emergencies and PDS warnings by their own names. */
export function warningName(a: Pick<WeatherAlert, "event" | "tags">): string {
  if (a.tags.includes("TORNADO EMERGENCY")) return "Tornado Emergency";
  if (a.tags.includes("FLASH FLOOD EMERGENCY")) return "Flash Flood Emergency";
  if (a.event === "Tornado Warning" && a.tags.includes("PDS")) return "PDS Tornado Warning";
  if (a.event === "Severe Thunderstorm Warning" && a.tags.includes("DESTRUCTIVE")) return "Destructive Severe Thunderstorm Warning";
  return a.event;
}

/** The middle of a polygon (the average of its outer ring), or null without one. */
function middle(g: WeatherAlert["geometry"]): { lat: number; lon: number } | null {
  const ring = g?.type === "Polygon" ? g.coordinates[0] : g?.type === "MultiPolygon" ? g.coordinates[0]?.[0] : undefined;
  if (!ring?.length) return null;
  const pts = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  return { lon: pts.reduce((s, p) => s + p[0]!, 0) / pts.length, lat: pts.reduce((s, p) => s + p[1]!, 0) / pts.length };
}

/**
 * The warnings in effect, one per warning (its newest message), most serious
 * first, then the newest. Cancelled, expired and polygon-less ones are left out.
 */
export function activeWarnings(features: RawAlertFeature[], now = Date.now()): StreamWarning[] {
  const byKey = new Map<string, StreamWarning>();
  for (const raw of features) {
    const ev = raw?.properties?.event;
    if (!(EVENTS as readonly string[]).includes(ev)) continue;
    const a = normalizeAlert(raw);
    const v = vtecOf(raw.properties.parameters?.VTEC?.[0]);
    const ends = a.ends ?? a.expires;
    if (!v || ["CAN", "EXP", "UPG"].includes(v.action) || !(Date.parse(ends) > now)) continue;
    const at = middle(a.geometry);
    if (!at) continue;
    const key = `${v.office}.${v.phenomena}.${v.significance}.${v.etn}.${new Date(a.sent).getUTCFullYear()}`;
    const prev = byKey.get(key);
    if (prev && Date.parse(prev.sent) >= Date.parse(a.sent)) continue;
    const areas = parseAreas(a.areaDesc);
    byKey.set(key, {
      key,
      event: ev as StreamEvent,
      name: warningName(a),
      tags: a.tags,
      areas,
      ends,
      zone: zoneFor(areas[0]?.state, ends),
      lat: at.lat,
      lon: at.lon,
      situation: situationOf(a.description),
      rank: a.rank,
      sent: a.sent,
      color: a.color,
    });
  }
  return [...byKey.values()].sort((a, b) => b.rank - a.rank || Date.parse(b.sent) - Date.parse(a.sent));
}

/**
 * Whether a newly issued warning is read aloud: every tornado warning, extreme
 * wind warning and emergency, and the destructive or considerable severe
 * thunderstorm and flash flood warnings. The rest are on the ticker only; on a
 * busy day there are dozens, and the stream would never stop talking.
 */
export function worthAnnouncing(w: StreamWarning): boolean {
  if (w.event === "Tornado Warning" || w.event === "Extreme Wind Warning") return true;
  return w.tags.some((t) => ["TORNADO EMERGENCY", "FLASH FLOOD EMERGENCY", "DESTRUCTIVE", "CONSIDERABLE", "TORNADO POSSIBLE"].includes(t));
}

/** What the narrator reads when a warning is issued, all from the warning itself. */
export function announcement(w: StreamWarning): string {
  const article = /^[AEIOU]/.test(w.name) ? "An" : "A";
  const until = clockText(w.ends, w.zone).spoken;
  return [`${article} ${w.name} has been issued for ${placesText(w.areas)}, until ${until}.`, w.situation].filter(Boolean).join(" ");
}

/** The lower-third title: "TORNADO WARNING · Cleveland and McClain Counties, OK · until 8:15 PM CDT". */
export function sceneTitle(w: StreamWarning): string {
  return `${w.name.toUpperCase()} · ${placesTitle(w.areas)} · until ${clockText(w.ends, w.zone).short}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "2 Tornado Warnings · 9 Severe Thunderstorm Warnings", most serious first. */
export function counts(ws: StreamWarning[]): string {
  return EVENTS.map((e) => [e, ws.filter((w) => w.event === e).length] as const)
    .filter(([, n]) => n > 0)
    .map(([e, n]) => plural(n, e))
    .join(" · ");
}

/** The ticker: the counts, then each warning in order, short. */
export function ticker(ws: StreamWarning[], max = 25): string {
  if (!ws.length) return "No tornado, severe thunderstorm or flash flood warnings in effect right now.";
  const items = ws.slice(0, max).map((w) => `${w.name}: ${placesTitle(w.areas)} until ${clockText(w.ends, w.zone).short}`);
  return [counts(ws), ...items, ws.length > max ? `and ${ws.length - max} more` : ""].filter(Boolean).join("   •   ");
}

export type Scene =
  | { kind: "national"; seconds: number }
  | { kind: "warning"; warning: StreamWarning; seconds: number }
  | { kind: "pro"; warning: StreamWarning | null; seconds: number };

/**
 * One cycle of scenes: the national radar, then the most serious warnings one
 * by one on the radar, then the top one in Professional mode. With nothing in
 * effect, the national radar and a Pro mode look around Oklahoma City take turns.
 */
export function cycle(ws: StreamWarning[], { perWarning = 35, maxWarnings = 5 } = {}): Scene[] {
  if (!ws.length)
    return [
      { kind: "national", seconds: 240 },
      { kind: "pro", warning: null, seconds: 90 },
    ];
  return [{ kind: "national", seconds: 30 }, ...ws.slice(0, maxWarnings).map((warning): Scene => ({ kind: "warning", warning, seconds: perWarning })), { kind: "pro", warning: ws[0]!, seconds: 60 }];
}

// ── The briefing ──────────────────────────────────────────────────────────

export interface Outlook {
  /** "SLIGHT", "ENHANCED"… or null for no severe risk. */
  risk: string | null;
  region: string;
}

const RISK_WORDS: Record<string, string> = { MARGINAL: "Marginal", SLIGHT: "Slight", ENHANCED: "Enhanced", MODERATE: "Moderate", HIGH: "High" };
const RISK_LEVEL: Record<string, number> = { MARGINAL: 1, SLIGHT: 2, ENHANCED: 3, MODERATE: 4, HIGH: 5 };

/** The facts, as the plain sentences read when there's no AI (or its version fails the check). */
export function briefingFacts(ws: StreamWarning[], outlook: Outlook | null): string {
  const now = ws.length ? `Right now there ${ws.length === 1 ? "is" : "are"} ${counts(ws).replace(/ · /g, ", ").replace(/, ([^,]*)$/, " and $1").toLowerCase()} in effect.` : "Right now there are no tornado, severe thunderstorm or flash flood warnings in effect.";
  const risk =
    outlook?.risk && RISK_WORDS[outlook.risk]
      ? `The Storm Prediction Center has a ${RISK_WORDS[outlook.risk]} Risk of severe storms today, level ${RISK_LEVEL[outlook.risk]} of 5${outlook.region ? `, for the ${outlook.region}` : ""}.`
      : "The Storm Prediction Center doesn't expect organized severe storms today.";
  return `${now} ${risk}`;
}

const HAZARDS = ["tornado", "hail", "wind", "flood", "flash", "hurricane", "emergency", "derecho", "blizzard", "snow", "ice"];
const numbersIn = (s: string): string[] => s.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * The AI's version of the briefing, if it's safe to read: short, every number
 * and hazard word in it also in the facts, no instructions to the viewer.
 */
export function checkBriefing(ai: string, facts: string): string | null {
  const s = ai.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (!s || s.split(" ").length > 60) return null;
  const f = facts.toLowerCase();
  if (numbersIn(s).some((n) => !numbersIn(facts).includes(n))) return null;
  if (HAZARDS.some((h) => s.toLowerCase().includes(h) && !f.includes(h))) return null;
  if (/\b(take cover|evacuate|shelter|seek|go to|you should|you must)\b/i.test(s)) return null;
  return s;
}

/** The prompt for the AI briefing. */
export const briefingPrompt = (facts: string) =>
  `You are the voice of a 24/7 weather radar livestream. Rewrite these facts as a short, calm, friendly spoken update (2 sentences, at most 45 words). Use only these facts: no other numbers, places, hazards or advice. Facts: ${facts}`;
