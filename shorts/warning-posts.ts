/**
 * Facebook posts for warnings as the NWS issues them (facebook-warnings.ts,
 * every few minutes): every Tornado Warning, Extreme Wind Warning and Flash
 * Flood Emergency, and the Severe Thunderstorm Warnings with a destructive
 * damage threat (80 mph winds or baseball-size hail), or all of them with
 * FB_SEVERE=all. One post per warning; a warning upgraded later (a tornado
 * warning that becomes PDS or an emergency) posts again. At most
 * FB_POSTS_PER_HOUR an hour (default 12): on a big outbreak day the rest are
 * skipped rather than flooding the Page, the most dangerous first.
 *
 * The text is the NWS's own facts (where, until when, the storm's position
 * and threats) in fixed sentences, with a link to the app and a reminder that
 * Storm Central isn't an official warning source.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAlert, type RawAlertFeature } from "../src/lib/alerts";
import type { WeatherAlert } from "../src/lib/api/types";
import { chipsOf, clockText, parseAreas, placesText, situationOf, vtecOf, zoneFor, type Area } from "./kinds/breaking";
import { STATE_NAMES } from "./narration";

export const WARNING_EVENTS = ["Tornado Warning", "Extreme Wind Warning", "Flash Flood Warning", "Severe Thunderstorm Warning"];
/** Too close to ending to be worth a post. */
const MIN_LEFT_MS = 10 * 60_000;
/** Posted warnings are remembered this long (none lasts longer). */
const KEEP_MS = 2 * 86_400_000;
const APP = "https://app.stormcentralwx.com";

/** How serious, for upgrades and for who goes first when there are too many. */
export type Level = 1 | 2 | 3 | 4;

export interface WarningPost {
  /** The warning across its updates: office, product, number and year. */
  base: string;
  level: Level;
  /** "TORNADO EMERGENCY", "TORNADO WARNING (PDS)", ... */
  title: string;
  /** NEW for a new warning, else the update that upgraded it. */
  upgrade: boolean;
  areas: Area[];
  ends: string;
  sent: string;
  message: string;
}

/** The warning's level, or null when it isn't posted (a plain flash flood warning, an ordinary severe thunderstorm warning). */
export function levelOf(a: WeatherAlert, severe: "destructive" | "all" = "destructive"): { level: Level; title: string } | null {
  const tags = a.tags;
  if (a.event === "Tornado Warning") {
    if (tags.includes("TORNADO EMERGENCY")) return { level: 4, title: "TORNADO EMERGENCY" };
    if (tags.includes("PDS")) return { level: 3, title: "PARTICULARLY DANGEROUS SITUATION TORNADO WARNING" };
    return { level: 2, title: tags.includes("OBSERVED") ? "TORNADO WARNING (TORNADO OBSERVED)" : "TORNADO WARNING" };
  }
  if (a.event === "Extreme Wind Warning") return { level: 4, title: "EXTREME WIND WARNING" };
  if (a.event === "Flash Flood Warning") return tags.includes("FLASH FLOOD EMERGENCY") ? { level: 4, title: "FLASH FLOOD EMERGENCY" } : null;
  if (a.event === "Severe Thunderstorm Warning") {
    if (tags.includes("DESTRUCTIVE")) return { level: 1, title: "DESTRUCTIVE SEVERE THUNDERSTORM WARNING" };
    if (severe === "all") return { level: 1, title: tags.includes("TORNADO POSSIBLE") ? "SEVERE THUNDERSTORM WARNING (TORNADO POSSIBLE)" : "SEVERE THUNDERSTORM WARNING" };
  }
  return null;
}

const SAFETY: Record<string, string> = {
  "Tornado Warning": "If you're in the warned area, go to a basement or an interior room on the lowest floor now, away from windows.",
  "Extreme Wind Warning": "If you're in the warned area, take shelter now in an interior room on the lowest floor, as if for a tornado.",
  "Flash Flood Warning": "If you're in the warned area, get to higher ground now. Never drive into flooded roads.",
  "Severe Thunderstorm Warning": "If you're in the warned area, move indoors to an interior room, away from windows.",
};

/** "#okwx" for each state, the hashtags weather Facebook and X use. */
const hashtags = (a: WeatherAlert, areas: Area[]) =>
  [`#${a.event.replace(/\s+/g, "")}`, ...[...new Set(areas.map((x) => x.state))].filter((s) => STATE_NAMES[s]).map((s) => `#${s.toLowerCase()}wx`)].join(" ");

/** The post's text: what, where, until when, the NWS's situation sentence and threats, what to do, the link and the reminder. */
export function warningMessage(a: WeatherAlert, title: string, upgrade: boolean, areas: Area[], ends: string): string {
  const zone = zoneFor(areas[0]?.state, ends);
  const where = placesText(areas, 8) || a.areaDesc;
  const until = clockText(ends, zone).short;
  const situation = situationOf(a.description);
  const chips = chipsOf(a).map((c) => `${c.label.charAt(0)}${c.label.slice(1).toLowerCase()}: ${c.value.toLowerCase()}`);
  const issuer = a.sender.replace(/^NWS\s+/, "the National Weather Service in ").replace(/\s([A-Z]{2})$/, ", $1");
  return [
    `${upgrade ? "UPGRADED: " : ""}${title} for ${where} until ${until}.`,
    situation,
    chips.length ? chips.join(" · ") : null,
    SAFETY[a.event],
    `Issued by ${issuer}. Follow the storm on live radar: ${APP}`,
    "Storm Central is not an official warning source. Always follow the National Weather Service and your local officials.",
    hashtags(a, areas),
  ]
    .filter((x): x is string => !!x)
    .join("\n\n");
}

/**
 * The warnings to post, from the NWS's active alerts: one per warning (its
 * newest message), new ones and upgrades of ones posted before, most
 * dangerous first. `posted` maps each warning already posted to its level.
 */
export function warningPosts(features: RawAlertFeature[], posted: Record<string, number>, { severe = "destructive" as "destructive" | "all", now = Date.now() } = {}): WarningPost[] {
  const newest = new Map<string, { a: WeatherAlert; action: string }>();
  for (const raw of features) {
    if (!raw?.properties?.event || !WARNING_EVENTS.includes(raw.properties.event)) continue;
    const v = vtecOf(raw.properties.parameters?.VTEC?.[0]);
    if (!v) continue;
    const a = normalizeAlert(raw);
    const base = `${v.office}.${v.phenomena}.${v.significance}.${v.etn}.${new Date(a.sent).getUTCFullYear()}`;
    const prev = newest.get(base);
    if (!prev || Date.parse(a.sent) > Date.parse(prev.a.sent)) newest.set(base, { a, action: v.action });
  }
  const out: WarningPost[] = [];
  for (const [base, { a, action }] of newest) {
    if (["CAN", "EXP", "UPG"].includes(action)) continue;
    const ends = a.ends ?? a.expires;
    if (Date.parse(ends) - now < MIN_LEFT_MS) continue;
    const l = levelOf(a, severe);
    if (!l) continue;
    const before = posted[base];
    if (before != null && before >= l.level) continue;
    const upgrade = before != null;
    const areas = parseAreas(a.areaDesc);
    out.push({ base, level: l.level, title: l.title, upgrade, areas, ends, sent: a.sent, message: warningMessage(a, l.title, upgrade, areas, ends) });
  }
  return out.sort((x, y) => y.level - x.level || Date.parse(y.sent) - Date.parse(x.sent));
}

// ─── What's been posted ──────────────────────────────────────────────────────

export interface PostState {
  /** Warning → the level it was posted at. */
  levels: Record<string, number>;
  /** Warning → when it was last posted (ms), for the hourly cap and forgetting old ones. */
  at: Record<string, number>;
}

const FILE = "facebook-warnings.json";

export function loadPostState(dir: string): PostState {
  try {
    const v = JSON.parse(readFileSync(join(dir, FILE), "utf8")) as Partial<PostState>;
    return { levels: v.levels ?? {}, at: v.at ?? {} };
  } catch {
    return { levels: {}, at: {} };
  }
}

export function savePostState(dir: string, s: PostState, now = Date.now()) {
  for (const [k, at] of Object.entries(s.at))
    if (now - at > KEEP_MS) {
      delete s.at[k];
      delete s.levels[k];
    }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILE), JSON.stringify(s, null, 2));
}

export const postedLastHour = (s: PostState, now = Date.now()) => Object.values(s.at).filter((at) => now - at < 3_600_000).length;

/**
 * Of `posts`, the ones there's room for this hour; the rest are marked as
 * handled at their level, so a warning skipped in a flood doesn't post an
 * hour late.
 */
export function withinCap(posts: WarningPost[], s: PostState, perHour: number, now = Date.now()): { post: WarningPost[]; skip: WarningPost[] } {
  const room = Math.max(0, perHour - postedLastHour(s, now));
  return { post: posts.slice(0, room), skip: posts.slice(room) };
}
