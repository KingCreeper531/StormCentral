/**
 * Which NWS alerts the Storm Central X account posts, and the words it uses.
 * Pure (no network, no clock reads) so it can be tested; bot/main.ts feeds it.
 *
 * Policy, most important first:
 *  1. Tornado and flash flood emergencies, and PDS tornado warnings.
 *  2. Tornado warnings; extreme wind warnings.
 *  3. Destructive severe thunderstorm warnings (or ones with a tornado
 *     possible, hail 2 in+, wind 80 mph+); tornado watches.
 *  4. Severe thunderstorm watches.
 * Each storm is posted once when issued, and once more if it is upgraded
 * to an emergency or PDS. Watches are posted once per watch number.
 */
import { normalizeAlert, type RawAlertFeature } from "../src/lib/alerts";
import type { WeatherAlert } from "../src/lib/api/types";

export const SITE = "https://storm-central-pi.vercel.app";
/** X counts every link as this many characters. */
export const LINK_WEIGHT = 23;
export const MAX_POST = 280;

/** A raw NWS feature with the parameters the bot needs beyond the app's normalised alert. */
export type BotFeature = RawAlertFeature & {
  properties: RawAlertFeature["properties"] & { parameters?: Record<string, string[] | undefined>; geocode?: { UGC?: string[] } };
};

export interface Vtec {
  action: string;
  office: string;
  phenomena: string;
  significance: string;
  etn: string;
  year: string;
}

/** "/O.NEW.KOUN.TO.W.0042.240521T2140Z-240521T2215Z/" → its parts (year from the end time). */
export function parseVtec(s: string | undefined): Vtec | null {
  // Times are YYMMDDTHHMMZ; a watch still in effect can start "000000T0000Z", so the year comes from the end.
  const m = /\/[OTEX]\.([A-Z]{3})\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\.(\d{2})\d{4}T\d{4}Z-(\d{2})\d{4}T\d{4}Z\//.exec(s ?? "");
  if (!m) return null;
  const year = m[7] !== "00" ? m[7]! : m[6]!;
  return { action: m[1]!, office: m[2]!, phenomena: m[3]!, significance: m[4]!, etn: m[5]!, year };
}

export type Level = "emergency" | "pds" | "normal";

export interface Candidate {
  /** Dedupe key: the same storm or watch at the same level is posted once. */
  key: string;
  /** Key of the storm or watch without the level (for "upgraded" posts). */
  eventKey: string;
  priority: 1 | 2 | 3 | 4;
  level: Level;
  alert: WeatherAlert;
  vtec: Vtec | null;
  states: string[];
  /** Whether this is an upgrade of something already posted. */
  upgrade: boolean;
  /** Watches: every state the watch covers (from all its county alerts). */
  watchStates?: string[];
}

const num = (s: string | undefined) => {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : 0;
};

/** Two-letter state codes from the UGC zone codes ("OKC109" → "OK"), else from the area text. */
export function statesOf(f: BotFeature): string[] {
  const ugc = f.properties.geocode?.UGC ?? [];
  const fromUgc = ugc.map((u) => u.slice(0, 2)).filter((s) => /^[A-Z]{2}$/.test(s));
  const fromText = [...(f.properties.areaDesc ?? "").matchAll(/,\s*([A-Z]{2})\b/g)].map((m) => m[1]!);
  return [...new Set(fromUgc.length ? fromUgc : fromText)];
}

function levelOf(a: WeatherAlert): Level {
  if (a.tags.includes("TORNADO EMERGENCY") || a.tags.includes("FLASH FLOOD EMERGENCY")) return "emergency";
  if (a.tags.includes("PDS") || (a.event === "Severe Thunderstorm Warning" && a.tags.includes("DESTRUCTIVE"))) return "pds";
  return "normal";
}

function priorityOf(a: WeatherAlert, level: Level): Candidate["priority"] | null {
  const hail = num(a.hazards.maxHail);
  const wind = num(a.hazards.maxWind);
  switch (a.event) {
    case "Tornado Warning":
      return level === "normal" ? 2 : 1;
    case "Extreme Wind Warning":
      return 2;
    case "Flash Flood Warning":
      return level === "emergency" ? 1 : null;
    case "Severe Thunderstorm Warning":
      return level !== "normal" || a.tags.includes("TORNADO POSSIBLE") || hail >= 2 || wind >= 80 ? 3 : null;
    case "Tornado Watch":
      return 3;
    case "Severe Thunderstorm Watch":
      return 4;
    default:
      return null;
  }
}

/**
 * Everything worth posting in the current alerts, deduplicated (one candidate
 * per storm or watch), most important first. `posted` holds the event keys
 * already posted and the level they were posted at.
 */
export function selectCandidates(features: BotFeature[], posted: Record<string, Level>, now: number): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const watchStates = new Map<string, Set<string>>();
  const rankLevel = { normal: 0, pds: 1, emergency: 2 } as const;

  for (const f of features) {
    const p = f.properties;
    if (!p?.event || p.messageType === "Cancel" || Date.parse(p.ends ?? p.expires) <= now) continue;
    const vtec = parseVtec(p.parameters?.VTEC?.[0]);
    if (vtec && ["CAN", "EXP", "UPG"].includes(vtec.action)) continue;
    const alert = normalizeAlert(f);
    const level = levelOf(alert);
    const priority = priorityOf(alert, level);
    if (priority == null) continue;

    const isWatch = vtec?.significance === "A";
    // A storm: office + phenomenon + number; a watch: phenomenon + number (many offices issue county alerts for it).
    const eventKey = vtec
      ? isWatch
        ? `${vtec.phenomena}.A.${vtec.etn}.${vtec.year}`
        : `${vtec.office}.${vtec.phenomena}.${vtec.significance}.${vtec.etn}.${vtec.year}`
      : alert.id;
    const states = statesOf(f);
    if (isWatch) {
      const set = watchStates.get(eventKey) ?? new Set<string>();
      states.forEach((s) => set.add(s));
      watchStates.set(eventKey, set);
    }

    const already = posted[eventKey];
    // New storms only when issued (not their follow-up statements), unless they've been upgraded since posting.
    if (already && rankLevel[level] <= rankLevel[already]) continue;
    if (!already && vtec && !isWatch && vtec.action !== "NEW" && level === "normal") continue;

    const cand: Candidate = { key: `${eventKey}@${level}`, eventKey, priority, level, alert, vtec, states, upgrade: !!already };
    const prev = byKey.get(eventKey);
    if (!prev || rankLevel[level] > rankLevel[prev.level]) byKey.set(eventKey, cand);
  }

  for (const c of byKey.values()) {
    if (c.vtec?.significance === "A") c.watchStates = [...(watchStates.get(c.eventKey) ?? [])].sort();
  }
  return [...byKey.values()].sort((a, b) => a.priority - b.priority || b.alert.rank - a.alert.rank || Date.parse(b.alert.sent) - Date.parse(a.alert.sent));
}

/* ---------- Wording ---------- */

/** Whether US daylight saving time is in effect at an instant (second Sunday of March to first Sunday of November, 2 AM local). */
function usDst(ms: number): boolean {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  // Approximated at 7 UTC (2 AM Central), close enough for naming a time zone.
  const start = Date.UTC(y, 2, nthSunday(2, 2), 7);
  const end = Date.UTC(y, 10, nthSunday(10, 1), 7);
  return ms >= start && ms < end;
}

/** "4:30 PM CDT" from an NWS time with its office's offset ("2026-05-21T16:30:00-05:00"). */
export function localTime(iso: string, states: string[] = []): string {
  const m = /T(\d{2}):(\d{2}).*([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return "";
  const h = Number(m[1]);
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
  const offset = (m[3] === "-" ? -1 : 1) * Number(m[4]);
  const dst = usDst(Date.parse(iso));
  const zones: Record<number, string> = dst
    ? { [-4]: "EDT", [-5]: "CDT", [-6]: "MDT", [-7]: states.includes("AZ") ? "MST" : "PDT", [-8]: "AKDT", [-10]: "HST" }
    : { [-4]: "AST", [-5]: "EST", [-6]: "CST", [-7]: "MST", [-8]: "PST", [-9]: "AKST", [-10]: "HST" };
  return zones[offset] ? `${clock} ${zones[offset]}` : clock;
}

/** "Cleveland, OK; McClain, OK; Grady, OK" → "Cleveland, McClain and Grady counties, OK" (counties trimmed to fit). */
export function placeText(areaDesc: string, maxCounties: number): string {
  const parts = areaDesc.split(";").map((s) => s.trim()).filter(Boolean);
  const byState = new Map<string, string[]>();
  for (const part of parts) {
    const m = /^(.*),\s*([A-Z]{2})$/.exec(part);
    const [name, st] = m ? [m[1]!, m[2]!] : [part, ""];
    byState.set(st, [...(byState.get(st) ?? []), name]);
  }
  const groups: string[] = [];
  let shown = 0;
  let total = 0;
  for (const [st, names] of byState) {
    total += names.length;
    const room = Math.max(0, maxCounties - shown);
    const take = names.slice(0, room);
    shown += take.length;
    if (!take.length) continue;
    const list = take.length === 1 ? take[0]! : `${take.slice(0, -1).join(", ")} and ${take.at(-1)}`;
    groups.push(st ? `${list}, ${st}` : list);
  }
  const more = total - shown;
  return more > 0 ? `${groups.join("; ")} and ${more} more` : groups.join("; ");
}

function headline(c: Candidate): string {
  const ev = c.alert.event.toUpperCase();
  if (c.level === "emergency") return c.alert.event === "Flash Flood Warning" ? "FLASH FLOOD EMERGENCY" : "TORNADO EMERGENCY";
  if (c.level === "pds" && c.alert.event === "Tornado Warning") return "PARTICULARLY DANGEROUS SITUATION: TORNADO WARNING";
  if (c.level === "pds") return `DESTRUCTIVE ${ev}`;
  return ev;
}

function details(c: Candidate): string[] {
  const a = c.alert;
  const out: string[] = [];
  if (a.event === "Tornado Warning" || a.tags.includes("TORNADO POSSIBLE")) {
    if (a.hazards.tornado === "OBSERVED") out.push("Tornado observed.");
    else if (a.event === "Tornado Warning") out.push("Radar indicated rotation.");
    else out.push("Tornado possible.");
  }
  const hail = num(a.hazards.maxHail);
  const wind = num(a.hazards.maxWind);
  if (hail >= 1) out.push(`Hail up to ${hail.toFixed(2)} in.`);
  if (wind >= 58) out.push(`Wind gusts to ${Math.round(wind)} mph.`);
  return out;
}

function action(c: Candidate): string {
  switch (c.alert.event) {
    case "Tornado Warning":
      return "Take shelter now if you are in the warned area.";
    case "Extreme Wind Warning":
      return "Take shelter in an interior room now.";
    case "Flash Flood Warning":
      return "Move to higher ground now. Never drive into flooded roads.";
    case "Severe Thunderstorm Warning":
      return "Move indoors and away from windows.";
    default:
      return "Have a plan and stay weather aware.";
  }
}

const hashtags = (states: string[]) =>
  states
    .slice(0, 2)
    .map((s) => `#${s.toLowerCase()}wx`)
    .join(" ");

/** A link to the storm on Storm Central's radar (the warning's centre, or none). */
export function radarLink(a: WeatherAlert): string | null {
  const g = a.geometry;
  if (!g) return null;
  const rings = g.type === "Polygon" ? [g.coordinates[0]!] : g.coordinates.map((p) => p[0]!);
  const pts = rings.flat();
  if (!pts.length) return null;
  const lon = pts.reduce((s, p) => s + p[0]!, 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1]!, 0) / pts.length;
  return `${SITE}/?mode=severe&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
}

/** X's weight-1 code point ranges (Latin, punctuation and the like); everything else, "…" and emoji included, counts 2. */
const LIGHT: readonly [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

/** Characters as X counts them: each link 23, then by code point (see LIGHT). */
export function weightedLength(text: string): number {
  let n = 0;
  for (const ch of text.replace(/https?:\/\/\S+/g, "x".repeat(LINK_WEIGHT))) {
    const cp = ch.codePointAt(0)!;
    n += LIGHT.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
  }
  return n;
}

/** The post: headline and place, what to expect, what to do, until when, tags and a radar link. Always ≤ 280. */
export function composePost(c: Candidate, { links = true }: { links?: boolean } = {}): string {
  const a = c.alert;
  const states = c.watchStates ?? c.states;
  const until = localTime(a.ends ?? a.expires, states);
  const link = links ? radarLink(a) : null;
  const tags = hashtags(states);

  if (c.vtec?.significance === "A") {
    const num = Number(c.vtec.etn);
    const where = states.length ? `for parts of ${states.length > 1 ? `${states.slice(0, -1).join(", ")} and ${states.at(-1)}` : states[0]}` : "";
    const lines = [
      `${a.event} ${num} ${where} until ${until}.`.replace(/\s+/g, " "),
      c.level !== "normal" ? "This is a particularly dangerous situation." : "",
      a.event === "Tornado Watch" ? "Conditions are favorable for tornadoes. Be ready to act if a warning is issued." : "Conditions are favorable for severe storms with damaging wind and hail.",
      tags,
      links ? `${SITE}/?mode=severe` : "",
    ];
    return fit(lines);
  }

  const prefix = c.upgrade ? "UPGRADED: " : "";
  for (const max of [6, 4, 3, 2, 1]) {
    const lines = [
      `${prefix}${headline(c)} for ${placeText(a.areaDesc, max)} until ${until}.`,
      details(c).join(" "),
      action(c),
      tags,
      link ?? "",
    ];
    const text = lines.filter(Boolean).join("\n");
    if (weightedLength(text) <= MAX_POST) return text;
  }
  return fit([`${prefix}${headline(c)} until ${until}.`, action(c), tags, link ?? ""]);
}

/** Joins lines, dropping the least important (from the end, keeping the link) until it fits. */
function fit(lines: string[]): string {
  const parts = lines.filter(Boolean);
  let text = parts.join("\n");
  while (weightedLength(text) > MAX_POST && parts.length > 2) {
    parts.splice(parts.length - 2, 1);
    text = parts.join("\n");
  }
  return weightedLength(text) <= MAX_POST ? text : text.slice(0, MAX_POST - 2) + "…";
}
