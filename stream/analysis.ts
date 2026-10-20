/**
 * The numbers behind the live stream's commentary, worked out exactly rather
 * than left to the AI: where a warned storm is now (from the warning's own
 * position and motion), how far it is from the nearest town, which towns are
 * in its path and when it would reach them (Storm Central's stormEta), and
 * the storm reports near it. The AI only puts these into words, and
 * checkAgainst throws out anything it adds.
 */
import { readFileSync } from "node:fs";
import type { StormReport } from "../src/lib/feeds/storm-reports";
import { bearingDeg, destination, haversineKm, type LatLon } from "../src/lib/geo";
import { stormEta } from "../src/lib/science/storm-motion";
import { clockText, placesText } from "../shorts/kinds/breaking";
import type { StreamWarning } from "./plan";

export interface Place extends LatLon {
  name: string;
  state: string;
  pop: number;
}

/** US towns of 5,000 people and more (GeoNames, written by setup.sh as name, state, lat, lon, population). */
export function loadPlaces(file: string): Place[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.split("\t"))
      .filter((c) => c.length >= 5)
      .map(([name, state, lat, lon, pop]) => ({ name: name!, state: state!, lat: Number(lat), lon: Number(lon), pop: Number(pop) }))
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } catch {
    return [];
  }
}

const KM_PER_MI = 1.609344;
const DIRS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const direction = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

export interface StormFacts {
  /** Where the storm is now. */
  at: LatLon;
  /** "4 miles southwest of Moore, OK" (or "over Moore, OK"), when a town is within 30 miles. */
  near: string | null;
  /** "moving northeast at 35 mph", when the warning gives a motion. */
  moving: string | null;
  /** Towns in its path in the next 90 minutes, soonest first. */
  ahead: { place: string; minutes: number; at: string }[];
}

/** Where the storm is and where it's heading, from the warning's position and motion and the towns around it. */
export function stormFacts(w: StreamWarning, places: Place[], now = Date.now()): StormFacts {
  const m = w.motion;
  let at: LatLon = { lat: w.lat, lon: w.lon };
  if (m?.positions[0]) {
    const [lon, lat] = m.positions[0];
    const minutes = Math.min(30, Math.max(0, (now - Date.parse(m.time)) / 60_000) || 0);
    at = m.speedKt > 0 ? destination({ lat, lon }, m.headingDeg, ((m.speedKt * 1.852) / 60) * minutes) : { lat, lon };
  }
  let nearest: { p: Place; km: number } | null = null;
  for (const p of places) {
    const km = haversineKm(p, at);
    // A small town right there beats a big one farther away; past 5 km, prefer bigger towns a little.
    const score = km < 5 ? km : km / Math.log10(Math.max(10, p.pop));
    if (km < 48 && (!nearest || score < (nearest.km < 5 ? nearest.km : nearest.km / Math.log10(Math.max(10, nearest.p.pop))))) nearest = { p, km };
  }
  const mi = nearest ? Math.round(nearest.km / KM_PER_MI) : 0;
  const near = nearest ? (mi < 2 ? `over ${nearest.p.name}, ${nearest.p.state}` : `${mi} miles ${direction(bearingDeg(nearest.p, at))} of ${nearest.p.name}, ${nearest.p.state}`) : null;
  const moving = m && m.speedKt >= 3 ? `moving ${direction(m.headingDeg)} at ${Math.round(m.speedKt * 1.15078)} mph` : null;
  const ahead =
    m && m.speedKt >= 3
      ? places
          .filter((p) => haversineKm(p, at) < 160)
          .map((p) => ({ p, eta: stormEta(m, p, 8, now) }))
          .filter((x): x is { p: Place; eta: number } => x.eta != null && x.eta > 2 && x.eta <= 90)
          .sort((a, b) => a.eta - b.eta)
          .slice(0, 4)
          .map(({ p, eta }) => ({ place: `${p.name}, ${p.state}`, minutes: Math.round(eta), at: clockText(new Date(now + eta * 60_000).toISOString(), w.zone).spoken }))
      : [];
  return { at, near, moving, ahead };
}

const REPORT_WORDS: Record<string, string> = { tornado: "a tornado", funnel: "a funnel cloud", hail: "hail", wind: "a wind gust", "wind-damage": "wind damage", flood: "flooding" };

/** Notable reports: tornadoes and funnels, hail of 1.5 inches and up, gusts of 65 mph and up, wind damage, flooding. */
export function notable(r: StormReport): boolean {
  if (r.kind === "tornado" || r.kind === "funnel" || r.kind === "wind-damage" || r.kind === "flood") return true;
  if (r.kind === "hail") return (r.magnitude ?? 0) >= 1.5;
  if (r.kind === "wind") return (r.magnitude ?? 0) >= 65;
  return false;
}

const POINTS: Record<string, string> = {
  N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast", SE: "southeast", SSE: "south-southeast",
  S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest", W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest",
};
const titleCase = (t: string) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** The NWS's "3 SW MOORE" as "3 miles southwest of Moore" ("near Moore" when it's just the town). */
export function spokenPlace(place: string): string {
  const m = /^(\d+(?:\.\d+)?)\s+([NSEW]{1,3})\s+(.+)$/i.exec(place.trim());
  if (m && POINTS[m[2]!.toUpperCase()]) return `${m[1]} mile${m[1] === "1" ? "" : "s"} ${POINTS[m[2]!.toUpperCase()]} of ${titleCase(m[3]!)}`;
  return `near ${titleCase(place.trim())}`;
}

/** "Trained spotter reported a tornado 3 miles southwest of Moore, OK at 7:52 PM Central time." */
export function reportSentence(r: StormReport, zone: string): string {
  const who = r.source ? r.source.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Someone";
  const size = r.kind === "hail" && r.magnitude ? ` ${r.magnitude}-inch` : "";
  const what = r.kind === "hail" ? `${size.trim() ? `${size.trim()} hail` : "hail"}` : r.kind === "wind" && r.magnitude ? `a ${Math.round(r.magnitude)} mph wind gust` : (REPORT_WORDS[r.kind] ?? r.typeText.toLowerCase());
  return `${who} reported ${what} ${spokenPlace(r.place)}${r.state ? `, ${r.state}` : ""} at ${clockText(r.time, zone).spoken}.`;
}

/** The reports near a storm in the last hour, newest first. */
export function reportsNear(reports: StormReport[], at: LatLon, now = Date.now(), km = 40): StormReport[] {
  return reports.filter((r) => notable(r) && now - Date.parse(r.time) < 60 * 60_000 && haversineKm(r, at) <= km).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

/** Everything known about a warned storm, as plain sentences: what the commentary may say. */
export function commentaryFacts(w: StreamWarning, f: StormFacts, reports: StormReport[]): string[] {
  const out = [`${w.name} for ${placesText(w.areas)}, until ${clockText(w.ends, w.zone).spoken}.`];
  if (f.near || f.moving) out.push(`The storm is ${[f.near, f.moving].filter(Boolean).join(", ")}.`);
  if (f.ahead.length) out.push(`On its current path it would reach ${f.ahead.map((a) => `${a.place} around ${a.at}`).join(", then ")}.`);
  if (w.situation) out.push(`The National Weather Service says: ${w.situation}`);
  if (w.chips.length) out.push(`The warning's tags: ${w.chips.map((c) => c.toLowerCase()).join(", ")}.`);
  for (const r of reports.slice(0, 3)) out.push(reportSentence(r, w.zone));
  return out;
}

const HAZARDS = ["tornado", "funnel", "debris", "rotation", "couplet", "hook", "wall cloud", "hail", "wind", "gust", "flood", "flash", "hurricane", "emergency", "derecho", "blizzard", "snow", "ice", "damage", "destructive", "catastrophic", "lightning"];
const ALLOWED_NAMES = new Set(["storm", "central", "national", "weather", "service", "prediction", "center", "nws", "spc", "eastern", "mountain", "pacific", "alaska", "hawaii", "atlantic", "am", "pm", "i", "doppler", "radar", "live", "hrrr", "tornado", "warning", "watch", "emergency", "severe", "thunderstorm", "flash", "flood", "pds", "extreme", "wind", "risk", "marginal", "slight", "enhanced", "moderate", "high", "today", "tonight", "right", "now"]);
const numbersIn = (s: string): string[] => s.match(/\d+(?:[.:]\d+)?/g) ?? [];

/**
 * The AI's text if it's safe to read: within `maxWords` (or `maxChars`), every
 * number, hazard and name in it also in the facts, and no instructions to
 * viewers (safety advice is read as written, never by the AI).
 */
export function checkAgainst(text: string, facts: string, { maxWords = 70, maxChars = 0 } = {}): string | null {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s || s.split(" ").length > maxWords || (maxChars && s.length > maxChars)) return null;
  const f = facts.toLowerCase();
  if (numbersIn(s).some((n) => !numbersIn(facts).includes(n))) return null;
  if (HAZARDS.some((h) => s.toLowerCase().includes(h) && !f.includes(h))) return null;
  // Capitalized words that don't start a sentence are names: each must be in the facts.
  const names = [...s.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+)*)/g)].map((m) => m[1]!);
  for (const n of names) for (const word of n.split(/\s+/)) if (!ALLOWED_NAMES.has(word.toLowerCase().replace(/[.'’]+$/, "")) && !f.includes(word.toLowerCase().replace(/[.'’]+$/, ""))) return null;
  if (/\b(take cover|evacuate|shelter|seek|go to|get to|you should|you must|stay inside|move to)\b/i.test(s)) return null;
  return s;
}
