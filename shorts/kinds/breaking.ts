/**
 * Breaking-news Shorts, checked every 10 minutes (youtube-breaking.yml): a
 * Short as soon as the National Weather Service issues a Tornado Emergency,
 * a Flash Flood Emergency, an Extreme Wind Warning, a PDS Tornado Warning or a
 * PDS Tornado Watch, or the Storm Prediction Center puts out a High Risk.
 *
 * Each event posts once: its key (the trigger plus the warning's VTEC office,
 * product and number, so updates of the same warning don't post again, but an
 * upgrade to an emergency does) goes into SHORTS_STATE_DIR/breaking.json once
 * it's up, kept in the Actions cache. At most SHORTS_BREAKING_DAILY_MAX a day
 * (YouTube's quota is about 6 uploads), none for an event ending within 20
 * minutes. The narration is the NWS's own facts in fixed sentences; the AI
 * narrator stays off for these (main.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAlert, type RawAlertFeature } from "../../src/lib/alerts";
import type { WeatherAlert } from "../../src/lib/api/types";
import { fitTitle, LINK_LINE, LINK_LINE_ES, regionOf, RISK_CODES, type GeoCollection } from "../meta";
import { STATE_NAMES } from "../narration";
import { getJson, readVendor, USER_AGENT } from "../source";
import { parseOutlook } from "../spc-outlook";
import type { Kind, KindContext, Video } from "../video";

const NWS = "https://api.weather.gov";
const IEM = "https://mesonet.agron.iastate.edu";
const SPC = "https://www.spc.noaa.gov/products/outlook";
/** No Short for an event this close to ending: it would be over before anyone sees it. */
const MIN_LEFT_MS = 20 * 60_000;
/** Posted keys are kept this long (no event lasts longer). */
const KEEP_MS = 3 * 86_400_000;

export type Trigger = "tornado-emergency" | "flash-flood-emergency" | "extreme-wind" | "pds-tornado-warning" | "pds-tornado-watch" | "high-risk";

interface TriggerInfo {
  /** As the NWS writes it in titles: "Tornado Emergency". */
  name: string;
  nameEs: string;
  /** The page's headline, two lines at most. */
  headline: [string, ...string[]];
  color: string;
  /** Higher goes first when several are out at once. */
  rank: number;
  /** What to do, read last. */
  safety: string;
}

export const TRIGGERS: Record<Trigger, TriggerInfo> = {
  "tornado-emergency": {
    name: "Tornado Emergency",
    nameEs: "Emergencia por tornado",
    headline: ["TORNADO", "EMERGENCY"],
    color: "#ff3fe0",
    rank: 6,
    safety: "If you're in the path, take cover now in a basement or an interior room on the lowest floor.",
  },
  "flash-flood-emergency": {
    name: "Flash Flood Emergency",
    nameEs: "Emergencia por inundaciones repentinas",
    headline: ["FLASH FLOOD", "EMERGENCY"],
    color: "#ff3b6b",
    rank: 5,
    safety: "Move to higher ground now, and never drive through flooded roads.",
  },
  "extreme-wind": {
    name: "Extreme Wind Warning",
    nameEs: "Aviso de vientos extremos",
    headline: ["EXTREME WIND", "WARNING"],
    color: "#ff8c00",
    rank: 4,
    safety: "Take cover now in an interior room, away from windows.",
  },
  "pds-tornado-warning": {
    name: "PDS Tornado Warning",
    nameEs: "Aviso de tornado PDS",
    headline: ["PDS TORNADO", "WARNING"],
    color: "#ff3b30",
    rank: 3,
    safety: "If you're in the path, take cover now in a basement or an interior room on the lowest floor.",
  },
  "pds-tornado-watch": {
    name: "PDS Tornado Watch",
    nameEs: "Vigilancia de tornado PDS",
    headline: ["PDS TORNADO", "WATCH"],
    color: "#ffd60a",
    rank: 2,
    safety: "If you're in the watch, have a plan and more than one way to get warnings.",
  },
  "high-risk": {
    name: "High Risk",
    nameEs: "Riesgo alto",
    headline: ["HIGH RISK"],
    color: "#ee99ee",
    rank: 1,
    safety: "If you live there, have a plan today and more than one way to get warnings.",
  },
};

// ─── Reading the alerts ──────────────────────────────────────────────────────

export interface Vtec {
  action: string;
  office: string;
  phenomena: string;
  significance: string;
  etn: number;
}

const VTEC = /\/[OTEX]\.([A-Z]{3})\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./;
/** The P-VTEC string's action, office, product and event number: "/O.CON.KOUN.TO.W.0045.…/". */
export function vtecOf(raw: string | undefined): Vtec | null {
  const m = raw ? VTEC.exec(raw) : null;
  return m ? { action: m[1]!, office: m[2]!, phenomena: m[3]!, significance: m[4]!, etn: Number(m[5]) } : null;
}

/** Which breaking trigger an alert is, if any. */
export function triggerOf(a: WeatherAlert): Trigger | null {
  if (a.event === "Tornado Warning") return a.tags.includes("TORNADO EMERGENCY") ? "tornado-emergency" : a.tags.includes("PDS") ? "pds-tornado-warning" : null;
  if (a.event === "Flash Flood Warning") return a.tags.includes("FLASH FLOOD EMERGENCY") ? "flash-flood-emergency" : null;
  if (a.event === "Extreme Wind Warning") return "extreme-wind";
  if (a.event === "Tornado Watch") return /PARTICULARLY DANGEROUS SITUATION/i.test(`${a.headline ?? ""} ${a.description}`) ? "pds-tornado-watch" : null;
  return null;
}

export interface Area {
  name: string;
  /** Two-letter state, "OK". */
  state: string;
}

/** "Cleveland, OK; McClain, OK" → the areas, in order, without repeats. */
export function parseAreas(areaDesc: string): Area[] {
  const seen = new Set<string>();
  const out: Area[] = [];
  for (const part of areaDesc.split(";")) {
    const m = /^\s*(.+?),\s*([A-Z]{2})\s*$/.exec(part);
    if (!m || seen.has(part.trim())) continue;
    seen.add(part.trim());
    out.push({ name: m[1]!.trim(), state: m[2]! });
  }
  return out;
}

const join_ = (parts: string[], and = "and") => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} ${and} ${parts.at(-1)}`);
const stateName = (code: string) => STATE_NAMES[code] ?? code;
const statesOf = (areas: Area[]) => [...new Set(areas.map((a) => a.state))];

/**
 * Where, for reading out: "Cleveland, McClain and Oklahoma counties in
 * Oklahoma"; with more than `max` areas, "parts of Oklahoma and Kansas".
 */
export function placesText(areas: Area[], max = 5): string {
  const states = statesOf(areas);
  if (!areas.length) return "";
  if (areas.length > max || states.length > 2) return `parts of ${join_(states.map(stateName))}`;
  return join_(
    states.map((s) => {
      const names = areas.filter((a) => a.state === s).map((a) => a.name);
      const unit = s === "LA" ? (names.length === 1 ? "parish" : "parishes") : names.length === 1 ? "county" : "counties";
      return `${join_(names)} ${unit} in ${stateName(s)}`;
    }),
  );
}

/** The same for a title: "Cleveland and McClain Counties, OK", or the states. */
export function placesTitle(areas: Area[]): string {
  const states = statesOf(areas);
  if (areas.length <= 3 && states.length === 1) return `${join_(areas.map((a) => a.name))} ${areas.length === 1 ? (states[0] === "LA" ? "Parish" : "County") : states[0] === "LA" ? "Parishes" : "Counties"}, ${states[0]}`;
  return join_(states.map(stateName));
}

// ─── Clock and time zones ────────────────────────────────────────────────────

/** Each state's main time zone; the alert's own UTC offset picks another where a state is split. */
const STATE_ZONE: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Denver", IL: "America/Chicago", IN: "America/New_York", IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/New_York", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver", PR: "America/Puerto_Rico",
};
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Puerto_Rico"];
const ZONE_WORD: Record<string, string> = {
  "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Phoenix": "Mountain",
  "America/Los_Angeles": "Pacific", "America/Anchorage": "Alaska", "Pacific/Honolulu": "Hawaii", "America/Puerto_Rico": "Atlantic",
};

/** "-05:00" for `zone` at `ms`. */
function offsetIn(zone: string, ms: number): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /GMT([+-]\d{2}:\d{2})/.exec(name);
  return m ? m[1]! : "+00:00";
}

/**
 * The alert's local time zone: the first state's, unless the alert's own
 * timestamp says otherwise ("2026-10-19T20:15:00-06:00" in the Texas
 * Panhandle is Central, in El Paso Mountain).
 */
export function zoneFor(state: string | undefined, iso: string): string {
  const preferred = STATE_ZONE[state ?? ""] ?? "America/Chicago";
  const offset = /([+-]\d{2}:\d{2})$/.exec(iso)?.[1];
  const ms = Date.parse(iso);
  if (!offset || offsetIn(preferred, ms) === offset) return preferred;
  return ZONES.find((z) => offsetIn(z, ms) === offset) ?? preferred;
}

/** "8:15 PM CDT" ("8:15 p.m. CDT" in Spanish: the US zone's own abbreviation) and, to read out, "8:15 PM Central time". */
export function clockText(iso: string, zone: string, locale = "en-US") {
  const ms = Date.parse(iso);
  const abbr = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(ms);
  return { short: `${time} ${abbr}`.trim(), spoken: `${time} ${ZONE_WORD[zone] ?? ""} time`.replace(/\s+/g, " ") };
}

// ─── The NWS's words ─────────────────────────────────────────────────────────

const ABBREVIATIONS = /\b(St|Ste|Mt|Ft)\./g;
/** Sentence case for an all-caps sentence (older products); in a mixed one, only shouted words ("TAKE COVER"), so acronyms stay. */
const calm = (s: string) => (/[a-z]/.test(s) ? s.replace(/\b[A-Z][A-Z']{3,}\b/g, (w) => w.toLowerCase()) : s.toLowerCase()).replace(/^./, (c) => c.toUpperCase());

/**
 * The warning's situation sentence without its clock time: "At 744 PM CDT, a
 * confirmed large and destructive tornado was located near Moore, moving
 * northeast at 30 mph." → "A confirmed large and destructive tornado was
 * located near Moore, moving northeast at 30 mph."
 */
export function situationOf(description: string): string | null {
  const text = description.replace(/\s+/g, " ").replace(ABBREVIATIONS, "$1~");
  const m = /\bAt \d{1,4} ?[AP]M [A-Z]{3,4},\s*(.+?[.!])(?=\s|$)/i.exec(text);
  if (!m) return null;
  const sentence = calm(m[1]!.replace(/~/g, ".").trim());
  return sentence.split(" ").length <= 45 ? sentence : null;
}

/** The impact-based tags as chips: TORNADO · OBSERVED, DAMAGE THREAT · CATASTROPHIC, HAIL · 2.75 IN, WIND · 80 MPH. */
export function chipsOf(a: WeatherAlert): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = [];
  if (a.hazards.tornado) chips.push({ label: "TORNADO", value: a.hazards.tornado.toUpperCase() });
  if (a.hazards.damageThreat) chips.push({ label: a.event === "Flash Flood Warning" ? "FLASH FLOOD" : "DAMAGE THREAT", value: a.hazards.damageThreat.toUpperCase() });
  if (a.hazards.maxHail && Number(a.hazards.maxHail) > 0) chips.push({ label: "HAIL", value: `${a.hazards.maxHail} IN` });
  if (a.hazards.maxWind && Number.parseInt(a.hazards.maxWind) > 0) chips.push({ label: "WIND", value: a.hazards.maxWind.toUpperCase().replace(/\s+/g, " ") });
  return chips;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface BreakingEvent {
  key: string;
  trigger: Trigger;
  issuer: string;
  areas: Area[];
  /** When it ends (ISO, with the issuing office's UTC offset), or null for an SPC outlook. */
  ends: string | null;
  zone: string;
  situation: string | null;
  chips: { label: string; value: string }[];
  /** Features to draw: the warning polygon, the watch box, or the High Risk area. */
  shapes: GeoCollection;
  /** Lesser SPC risk areas around a High Risk, drawn faintly. */
  context: GeoCollection;
  /** The storm's position and motion from the warning (TIME...MOT...LOC). */
  motion: { lon: number; lat: number; headingDeg: number; speedKt: number } | null;
  /** High Risk only: the region and SPC's summary. */
  region: string;
  summary: string;
  sent: string;
}

/** "NWS Norman OK" → "National Weather Service in Norman, OK". */
export const issuerOf = (sender: string) => sender.replace(/^NWS\s+/, "National Weather Service in ").replace(/\s([A-Z]{2})$/, ", $1");

const feature = (geometry: unknown, color: string): GeoCollection["features"][number] => ({ type: "Feature", geometry, properties: { fill: color, stroke: color } });

interface IemWatchProps {
  num?: number;
  type?: string;
  is_pds?: boolean;
}

/** One warning across its messages: office, product and number, plus the year. */
const baseOf = (v: Vtec, sent: string) => `${v.office}.${v.phenomena}.${v.significance}.${v.etn}.${new Date(sent).getUTCFullYear()}`;

/**
 * The warnings and watches that qualify, one event per warning, from its
 * newest message (so one downgraded since doesn't count), with the areas of
 * every office's copy of a watch.
 */
export function alertEvents(features: RawAlertFeature[], watches: { features?: { geometry: unknown; properties: IemWatchProps }[] } | null, now = Date.now()): BreakingEvent[] {
  const byBase = new Map<string, BreakingEvent>();
  const pdsWatches = new Set((watches?.features ?? []).filter((f) => f.properties.type === "TOR" && f.properties.is_pds).map((f) => f.properties.num));
  const newest = new Map<string, number>();
  for (const raw of features) {
    const v = vtecOf(raw?.properties?.parameters?.VTEC?.[0]);
    if (v && raw.properties.sent) newest.set(baseOf(v, raw.properties.sent), Math.max(newest.get(baseOf(v, raw.properties.sent)) ?? 0, Date.parse(raw.properties.sent)));
  }
  for (const raw of features) {
    if (!raw?.properties?.event) continue;
    const a = normalizeAlert(raw);
    const vtec = vtecOf(raw.properties.parameters?.VTEC?.[0]);
    if (vtec && a.event !== "Tornado Watch" && Date.parse(a.sent) < (newest.get(baseOf(vtec, a.sent)) ?? 0)) continue;
    let trigger = triggerOf(a);
    if (!trigger && a.event === "Tornado Watch" && vtec && pdsWatches.has(vtec.etn)) trigger = "pds-tornado-watch";
    if (!trigger || !vtec || ["CAN", "EXP", "UPG"].includes(vtec.action)) continue;
    const ends = a.ends ?? a.expires;
    if (Date.parse(ends) - now < MIN_LEFT_MS) continue;
    const base = baseOf(vtec, a.sent);
    const areas = parseAreas(a.areaDesc);
    const prev = byBase.get(base);
    if (prev && trigger === "pds-tornado-watch") {
      // Each office sends its own copy of a watch: gather all their counties.
      for (const x of areas) if (!prev.areas.some((p) => p.name === x.name && p.state === x.state)) prev.areas.push(x);
      continue;
    }
    // A warning's newest message says what it is now (a PDS warning upgraded to an emergency, say).
    if (prev && Date.parse(prev.sent) >= Date.parse(a.sent)) continue;
    const color = TRIGGERS[trigger].color;
    const box = trigger === "pds-tornado-watch" ? (watches?.features ?? []).find((f) => f.properties.num === vtec.etn && f.geometry) : undefined;
    const geometry = a.geometry ?? box?.geometry ?? null;
    const pos = a.motion?.positions[0];
    byBase.set(base, {
      key: `${trigger}:${base}`,
      trigger,
      issuer: trigger === "pds-tornado-watch" ? "Storm Prediction Center" : issuerOf(a.sender),
      areas,
      ends,
      zone: zoneFor(areas[0]?.state, ends),
      situation: trigger === "pds-tornado-watch" ? null : situationOf(a.description),
      chips: chipsOf(a),
      shapes: { type: "FeatureCollection", features: geometry ? [feature(geometry, color)] : [] },
      context: { type: "FeatureCollection", features: [] },
      motion: a.motion && pos ? { lon: pos[0], lat: pos[1], headingDeg: a.motion.headingDeg, speedKt: a.motion.speedKt } : null,
      region: "",
      summary: "",
      sent: a.sent,
    });
  }
  return [...byBase.values()];
}

/** A High Risk on SPC's Day 1 outlook, one event per convective day. */
export function highRiskEvent(productText: string, issued: string, cat: GeoCollection | null): BreakingEvent | null {
  const o = parseOutlook(productText);
  if (!o || o.risk !== "HIGH") return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.parse(issued));
  const features = (cat?.features ?? []).filter((f) => f.geometry && f.properties.LABEL);
  return {
    key: `high-risk:${day}`,
    trigger: "high-risk",
    issuer: "Storm Prediction Center",
    areas: [],
    ends: null,
    zone: "America/Chicago",
    situation: null,
    chips: [],
    shapes: { type: "FeatureCollection", features: features.filter((f) => f.properties.LABEL === RISK_CODES.HIGH) },
    context: { type: "FeatureCollection", features: features.filter((f) => f.properties.LABEL !== RISK_CODES.HIGH && f.properties.LABEL !== "TSTM") },
    motion: null,
    region: regionOf(productText),
    summary: o.summary,
    sent: issued,
  };
}

/** Highest trigger first, then the newest. */
export const byPriority = (a: BreakingEvent, b: BreakingEvent) => TRIGGERS[b.trigger].rank - TRIGGERS[a.trigger].rank || Date.parse(b.sent) - Date.parse(a.sent);

/** Everything that qualifies right now, best first. A source that fails is skipped, not fatal. */
export async function findEvents(ctx: KindContext, now = Date.now()): Promise<BreakingEvent[]> {
  const alerts = getJson<{ features?: RawAlertFeature[] }>(
    ctx,
    "nws-active.json",
    `${NWS}/alerts/active?status=actual&event=${encodeURIComponent("Tornado Warning,Flash Flood Warning,Extreme Wind Warning,Tornado Watch")}`,
  ).catch((err: unknown) => {
    // A fixture folder holds only the files its scenario needs.
    if (!ctx.fixtures) console.warn(`::warning::NWS alerts: ${err instanceof Error ? err.message : err}`);
    return { features: [] as RawAlertFeature[] };
  });
  const watches = getJson<{ features?: { geometry: unknown; properties: IemWatchProps }[] }>(ctx, "iem-watches.json", `${IEM}/api/1/spc_watch_outline.geojson`).catch(() => null);
  const outlook = (async () => {
    let swo: { productText: string; issuanceTime: string };
    if (ctx.fixtures) swo = await getJson(ctx, "swody1.json", "");
    else {
      const list = await getJson<{ "@graph"?: { id: string }[] }>(ctx, "swo-list.json", `${NWS}/products/types/SWO/locations/DY1`);
      const id = list["@graph"]?.[0]?.id;
      if (!id) return null;
      swo = await getJson(ctx, "swody1.json", `${NWS}/products/${id}`);
    }
    if (parseOutlook(swo.productText)?.risk !== "HIGH") return null;
    const cat = await getJson<GeoCollection>(ctx, "day1_cat.geojson", `${SPC}/day1otlk_cat.lyr.geojson`).catch(() => null);
    return highRiskEvent(swo.productText, swo.issuanceTime, cat);
  })().catch(() => null);
  const [a, w, high] = await Promise.all([alerts, watches, outlook]);
  return [...alertEvents(a.features ?? [], w, now), ...(high ? [high] : [])].sort(byPriority);
}

// ─── Posted events ───────────────────────────────────────────────────────────

export interface BreakingState {
  /** Event key → when it was posted (ms). */
  posted: Record<string, number>;
}

const STATE_FILE = "breaking.json";
const stateDir = (env: Record<string, string | undefined>) => env.SHORTS_STATE_DIR || "shorts/.state";

export function loadState(dir: string): BreakingState {
  const file = join(dir, STATE_FILE);
  if (!existsSync(file)) return { posted: {} };
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<BreakingState>;
    return { posted: v.posted && typeof v.posted === "object" ? v.posted : {} };
  } catch {
    return { posted: {} };
  }
}

/** Records `keys` as posted at `now`, forgetting anything older than three days. */
export function markPosted(dir: string, keys: string[], now = Date.now()) {
  const s = loadState(dir);
  for (const k of keys) s.posted[k] = now;
  for (const [k, at] of Object.entries(s.posted)) if (now - at > KEEP_MS) delete s.posted[k];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(s, null, 2));
}

/** YouTube's quota day runs on Pacific time. */
const quotaDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
export const postedToday = (s: BreakingState, now = Date.now()) => Object.values(s.posted).filter((at) => quotaDay(at) === quotaDay(now)).length;

const rankOfKey = (key: string) => TRIGGERS[key.split(":")[0] as Trigger]?.rank ?? 0;
const baseOfKey = (key: string) => key.slice(key.indexOf(":") + 1);

/**
 * The events still to post, best first, within today's cap. A warning posted
 * once posts again only when it's upgraded (PDS → emergency), never when it's
 * downgraded.
 */
export function toPost(events: BreakingEvent[], s: BreakingState, { dailyMax = 2, perRun = 1, now = Date.now() } = {}): BreakingEvent[] {
  const room = Math.max(0, Math.min(perRun, dailyMax - postedToday(s, now)));
  const best = new Map<string, number>();
  for (const k of Object.keys(s.posted)) best.set(baseOfKey(k), Math.max(best.get(baseOfKey(k)) ?? 0, rankOfKey(k)));
  return events.filter((e) => (best.get(baseOfKey(e.key)) ?? 0) < TRIGGERS[e.trigger].rank).slice(0, room);
}

/** The clock: SHORTS_NOW (ISO) for fixtures, which would otherwise have long expired. */
export const clockOf = (env: Record<string, string | undefined>) => (env.SHORTS_NOW && Number.isFinite(Date.parse(env.SHORTS_NOW)) ? Date.parse(env.SHORTS_NOW) : Date.now());

export const limits = (env: Record<string, string | undefined>) => ({
  dailyMax: Math.max(0, Number(env.SHORTS_BREAKING_DAILY_MAX ?? 2) || 0),
  perRun: Math.max(1, Number(env.SHORTS_BREAKING_MAX) || 1),
});

// ─── The video ───────────────────────────────────────────────────────────────

/** How long a line takes to read, roughly (the narrator speaks about 2.6 words a second). */
const readSeconds = (s: string) => s.split(/\s+/).filter(Boolean).length / 2.6;

export interface BreakingLines {
  intro: string;
  situation: string | null;
  until: string | null;
  safety: string;
}

/** What the narrator reads, all from the alert's facts. */
export function breakingLines(e: BreakingEvent): BreakingLines {
  const t = TRIGGERS[e.trigger];
  const article = /^[AEIOU]/.test(t.name) ? "an" : "a";
  let intro: string;
  if (e.trigger === "high-risk") intro = `Breaking: the Storm Prediction Center has issued a High Risk of severe storms, level 5 of 5${e.region ? `, for the ${e.region}` : ""}.`;
  else if (e.trigger === "pds-tornado-watch") intro = `Breaking: the Storm Prediction Center has issued a particularly dangerous situation Tornado Watch for ${placesText(e.areas)}.`;
  else if (e.trigger === "pds-tornado-warning") intro = `Breaking: the ${e.issuer} has issued a particularly dangerous situation Tornado Warning for ${placesText(e.areas)}.`;
  else intro = `Breaking: the ${e.issuer} has issued ${article} ${t.name} for ${placesText(e.areas)}.`;
  const situation = e.trigger === "high-risk" ? firstSentences(e.summary) || null : e.situation;
  return {
    intro,
    situation,
    until: e.ends ? `It's in effect until ${clockText(e.ends, e.zone).spoken}.` : e.trigger === "high-risk" ? "It's the highest level the Storm Prediction Center issues." : null,
    safety: t.safety,
  };
}

function firstSentences(s: string, room = 170) {
  let out = "";
  for (const x of s.match(/[^.!?]+[.!?]+/g) ?? [s]) {
    if (out && (out + x).length > room) break;
    out += x;
  }
  return out.trim();
}

/** When each scene starts, from how long the lines before it take to read. */
export function breakingTiming(lines: BreakingLines) {
  const situation = Math.max(6.2, 0.4 + readSeconds(lines.intro) + 0.6);
  const until = lines.situation ? situation + readSeconds(lines.situation) + 0.6 : situation;
  const safety = lines.until ? until + readSeconds(lines.until) + 0.6 : until;
  const end = Math.max(18, safety + readSeconds(lines.safety) + 1.2);
  return { situation: round1(situation), until: round1(until), safety: round1(safety), end: round1(end) };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

const NOT_OFFICIAL = "Not an official warning source; follow the National Weather Service.";
const NOT_OFFICIAL_ES = "No es una fuente oficial de alertas; sigue al Servicio Meteorológico Nacional.";

export function breakingText(e: BreakingEvent, lines: BreakingLines) {
  const t = TRIGGERS[e.trigger];
  const until = e.ends ? clockText(e.ends, e.zone).short : null;
  const untilEs = e.ends ? clockText(e.ends, e.zone, "es-MX").short : null;
  const where = e.trigger === "high-risk" ? e.region || "the U.S." : placesTitle(e.areas);
  const states = e.trigger === "high-risk" ? e.region || "the U.S." : statesOf(e.areas).map(stateName).join(", ");
  const name = e.trigger === "high-risk" ? "High Risk of Severe Storms" : t.name;
  const lead = until ? `${lines.intro.replace(/^Breaking: the/, "BREAKING: The").replace(/\.$/, "")}, until ${until}.` : lines.intro.replace(/^Breaking: the/, "BREAKING: The");
  const tagsEs = e.trigger === "high-risk" ? "#tormentas #tornado #clima #shorts" : e.trigger === "flash-flood-emergency" ? "#inundaciones #clima #shorts" : "#tornado #clima #shorts";
  return {
    title: fitTitle(
      ...(until ? [`${name} for ${where} Until ${until} #shorts`, `${name}: ${states} Until ${until} #shorts`] : []),
      `${name} for ${where} #shorts`,
      `${name}: ${states} #shorts`,
      `${name} #shorts`,
    ),
    description: [
      lead,
      lines.situation,
      lines.safety,
      NOT_OFFICIAL,
      LINK_LINE,
      e.trigger === "flash-flood-emergency" ? "#flashflood #flooding #breakingnews #weather #shorts" : e.trigger === "high-risk" ? "#severeweather #tornado #breakingnews #weather #shorts" : "#tornado #tornadowarning #breakingnews #weather #shorts",
    ]
      .filter(Boolean)
      .join("\n\n"),
    es: {
      title: fitTitle(
        ...(untilEs ? [`${t.nameEs}: ${states}, hasta las ${untilEs} #shorts`] : []),
        `${t.nameEs}: ${states} #shorts`,
        `${t.nameEs} #shorts`,
      ),
      description: [
        e.trigger === "high-risk"
          ? `ÚLTIMA HORA: el Centro de Predicción de Tormentas emitió un riesgo alto de tormentas severas (nivel 5 de 5)${e.region ? ` para la región ${e.region}` : ""}.`
          : `ÚLTIMA HORA: ${e.trigger === "pds-tornado-watch" ? "el Centro de Predicción de Tormentas" : "el Servicio Meteorológico Nacional"} emitió: ${t.nameEs}, en ${statesOf(e.areas).map(stateName).join(", ")}${untilEs ? `, hasta las ${untilEs}` : ""}.`,
        NOT_OFFICIAL_ES,
        LINK_LINE_ES,
        tagsEs,
      ].join("\n\n"),
    },
  };
}

/**
 * IEM's national radar mosaic behind a warning's polygon, as a data: URL with
 * its corners. Warnings only (a few dozen miles across, where Web Mercator
 * and the page's conic map line up); null when it can't be had.
 */
export async function radarBackdrop(
  ctx: KindContext,
  shapes: GeoCollection,
  { width = 1000, height = 690, frac = 0.45 } = {},
): Promise<{ url: string; west: number; south: number; east: number; north: number } | null> {
  if (ctx.fixtures || !shapes.features.length) return null;
  const pts: [number, number][] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") pts.push(c as [number, number]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  for (const f of shapes.features) walk((f.geometry as { coordinates?: unknown })?.coordinates);
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const [w0, e0, s0, n0] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const lat = (s0 + n0) / 2, lon = (w0 + e0) / 2;
  const cos = Math.cos((lat * Math.PI) / 180);
  // Cover the zoomed map (width x height, the polygon in about `frac` of it) with room to spare.
  const degPerPx = (Math.max(((e0 - w0) * cos) / width, (n0 - s0) / height, 0.02 / height) / frac) * 1.3;
  const box = { west: lon - (degPerPx * width) / 2 / cos, east: lon + (degPerPx * width) / 2 / cos, south: lat - (degPerPx * height) / 2, north: lat + (degPerPx * height) / 2 };
  const merc = (lo: number, la: number) => [(lo * 20037508.34) / 180, (Math.log(Math.tan(((90 + la) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180)];
  const [x0, y0] = merc(box.west, box.south), [x1, y1] = merc(box.east, box.north);
  const url = `${IEM}/cgi-bin/wms/nexrad/n0q.cgi?service=WMS&version=1.1.1&request=GetMap&layers=nexrad-n0q-900913&styles=&srs=EPSG:3857&bbox=${[x0, y0, x1, y1].map((v) => v!.toFixed(0)).join(",")}&width=${width}&height=${height}&format=image/png&transparent=true`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !res.headers.get("content-type")?.includes("image/png")) return null;
    return { url: `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`, ...box };
  } catch {
    return null;
  }
}

export function setOutput(env: Record<string, string | undefined>, name: string, value: string) {
  if (env.GITHUB_OUTPUT) writeFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: "a" });
}

const slug = (key: string) => key.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

export const breakingKind: Kind = async (ctx) => {
  const now = clockOf(ctx.env);
  const events = await findEvents(ctx, now);
  console.log(`Breaking: ${events.map((e) => e.key).join(", ") || "nothing qualifies right now"}.`);
  // Manual runs (and fixtures) show the top event whether or not it was posted.
  const manual = ctx.env.SHORTS_LATEST === "1" || !!ctx.fixtures;
  const { dailyMax, perRun } = limits(ctx.env);
  const wanted = ctx.env.SHORTS_BREAKING_EVENT;
  const ordered = wanted ? [...events.filter((e) => e.key === wanted), ...events.filter((e) => e.key !== wanted)] : events;
  const picked = manual ? ordered.slice(0, perRun) : toPost(ordered, loadState(stateDir(ctx.env)), { dailyMax, perRun, now });
  if (!picked.length) return [];
  setOutput(ctx.env, "breaking_keys", picked.map((e) => e.key).join(","));
  const states = readVendor("states-10m.json");
  return Promise.all(
    picked.map(async (e): Promise<Video> => {
      const t = TRIGGERS[e.trigger];
      const lines = breakingLines(e);
      const radar = ["pds-tornado-watch", "high-risk"].includes(e.trigger) ? null : await radarBackdrop(ctx, e.shapes);
      // One state: just the names under "Counties in Oklahoma"; several: "Cleveland, OK".
      const codes = statesOf(e.areas);
      const one = codes.length === 1 ? codes[0]! : null;
      const shown = e.areas.slice(0, 6).map((a) => (one ? a.name : `${a.name}, ${a.state}`));
      const unit = one === "LA" ? (e.areas.length === 1 ? "Parish" : "Parishes") : e.areas.length === 1 ? "County" : "Counties";
      return {
        key: `breaking-${slug(e.key)}`,
        template: "breaking.html",
        ...breakingText(e, lines),
        tags: ["breaking weather", t.name.toLowerCase(), "severe weather", "national weather service", "Storm Central", ...statesOf(e.areas).map(stateName)],
        playlist: "Breaking Severe Weather",
        data: {
          states,
          event: {
            trigger: e.trigger,
            headline: t.headline,
            color: t.color,
            issuer: e.issuer,
            areas: shown,
            areasLabel: one ? `${unit} in ${stateName(one)}` : "For these areas",
            more: Math.max(0, e.areas.length - shown.length),
            where: e.trigger === "high-risk" ? e.region : placesTitle(e.areas),
            stateNames: statesOf(e.areas).map(stateName),
            until: e.ends ? clockText(e.ends, e.zone).short : null,
            chips: e.chips,
            shapes: e.shapes,
            context: e.context,
            motion: e.motion,
            radar,
            zoomed: !["pds-tornado-watch", "high-risk"].includes(e.trigger),
          },
          lines,
          timing: breakingTiming(lines),
        },
      };
    }),
  );
};
