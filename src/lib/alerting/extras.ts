/**
 * The newer notifications: lightning nearby, severe spotter reports nearby,
 * and the morning briefing. On the web and in the Windows app the page runs
 * these (components/alerts/alert-watcher.tsx); Android runs the same checks
 * natively (android/.../AlertsWorker.java) so they work with the app closed.
 * Keep the wording of the two in step.
 */
import type { Forecast } from "../api/open-meteo";
import type { PostDto } from "../community";
import { describeCode } from "../weather/wmo";
import { clockAt, formatTemp, formatWind, hashId } from "./format";
import type { AppNotification, SavedPlace, WatchConfig } from "./types";
import { CURRENT_PLACE_ID, DEFAULT_LIGHTNING, DEFAULT_SPOTTER } from "./types";

export interface ExtrasIO {
  now(): number;
  /** The device's local clock: minutes since midnight and the calendar day ("2026-10-13"). */
  localClock(): { minutes: number; day: string };
  fetchForecast(lat: number, lon: number): Promise<Forecast>;
  /** Distance (km) to the nearest lightning in the last 15 minutes within `radiusKm`, or null. */
  fetchLightningKm(lat: number, lon: number, radiusKm: number): Promise<number | null>;
  fetchNearbyReports(lat: number, lon: number, radiusKm: number): Promise<PostDto[]>;
  kvGet(key: string): string | null;
  kvSet(key: string, value: string): void;
  notify(n: AppNotification): void | Promise<void>;
}

const LIGHTNING_KEY = "lightning-at";
const REPORTS_KEY = "seen-reports";
const BRIEFING_KEY = "briefing-day";
export const LIGHTNING_COOLDOWN_MS = 45 * 60_000;
export const REPORT_MAX_AGE_MS = 60 * 60_000;
export const BRIEFING_WINDOW_MIN = 180;

function readJson<T>(io: ExtrasIO, key: string, fallback: T): T {
  try {
    const raw = io.kvGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const imperial = (cfg: WatchConfig) => cfg.units.temp === "F";

function distanceText(km: number, mi: boolean) {
  const d = mi ? km / 1.609 : km;
  if (d < 1.5) return mi ? "within a mile" : "within a kilometre";
  return `about ${Math.round(d)} ${mi ? "mi" : "km"} away`;
}

/** Places warnings are checked for (the selected location only when asked). */
function watched(cfg: WatchConfig): SavedPlace[] {
  return cfg.settings.watchCurrent ? cfg.places : cfg.places.filter((p) => p.id !== CURRENT_PLACE_ID);
}

/* ---------- Lightning ---------- */

export function lightningNotification(place: SavedPlace, km: number, mi: boolean, now: number): AppNotification {
  return {
    id: hashId(`lightning:${place.id}:${Math.floor(now / LIGHTNING_COOLDOWN_MS)}`),
    title: `Lightning near ${place.name}`,
    body: `Lightning detected ${distanceText(km, mi)} in the last 15 minutes. When thunder roars, go indoors.`,
    kind: "lightning",
  };
}

/** One notification per place while lightning keeps going, at most every 45 minutes. */
export async function checkLightning(cfg: WatchConfig, io: ExtrasIO): Promise<AppNotification[]> {
  const opts = cfg.settings.lightning;
  if (!cfg.settings.enabled || !opts?.enabled) return [];
  const radius = Math.min(50, Math.max(3, opts.radiusKm || DEFAULT_LIGHTNING.radiusKm));
  const now = io.now();
  const last = readJson<Record<string, number>>(io, LIGHTNING_KEY, {});
  const sent: AppNotification[] = [];
  for (const place of watched(cfg)) {
    if (now - (last[place.id] ?? 0) < LIGHTNING_COOLDOWN_MS) continue;
    const km = await io.fetchLightningKm(place.lat, place.lon, radius).catch(() => null);
    if (km == null) continue;
    last[place.id] = now;
    const n = lightningNotification(place, km, imperial(cfg), now);
    await io.notify(n);
    sent.push(n);
  }
  io.kvSet(LIGHTNING_KEY, JSON.stringify(last));
  return sent;
}

/* ---------- Spotter reports ---------- */

const SEVERE: Partial<Record<PostDto["category"], string>> = {
  tornado: "Tornado or funnel cloud",
  hail: "Hail",
  wind: "Wind damage",
  flooding: "Flooding",
};

/** Severe categories always count; anything else when marked Significant or Dangerous. */
export function isNotableReport(p: PostDto) {
  return p.category in SEVERE || p.severity >= 2;
}

export function reportNotification(p: PostDto, place: SavedPlace, mi: boolean): AppNotification {
  const what = SEVERE[p.category] ?? (p.severity >= 3 ? "Dangerous weather" : "Significant weather");
  const km = p.distanceKm ?? 0;
  const d = mi ? km / 1.609 : km;
  const where = d < 1 ? "nearby" : `${Math.round(d)} ${mi ? "mi" : "km"} from ${place.name}`;
  const text = p.body.replace(/\s+/g, " ").trim();
  return {
    id: hashId(`report:${p.id}`),
    title: `${what} reported ${where}`,
    body: `${p.author.displayName}: ${text.length > 140 ? `${text.slice(0, 137)}…` : text}`,
    kind: "spotter",
  };
}

/** New severe reports (last hour) near each watched place, from others, each announced once. */
export async function checkSpotterReports(cfg: WatchConfig, io: ExtrasIO): Promise<AppNotification[]> {
  const opts = cfg.settings.spotter;
  if (!cfg.settings.enabled || !opts?.enabled || !cfg.community) return [];
  const radius = Math.min(200, Math.max(5, opts.radiusKm || DEFAULT_SPOTTER.radiusKm));
  const now = io.now();
  const self = cfg.community.username?.toLowerCase() ?? null;
  const muted = new Set(cfg.community.muted.map((u) => u.toLowerCase()));
  const seen = readJson<Record<string, number>>(io, REPORTS_KEY, {});
  const sent: AppNotification[] = [];
  for (const place of watched(cfg)) {
    const posts = await io.fetchNearbyReports(place.lat, place.lon, radius).catch(() => [] as PostDto[]);
    for (const p of posts) {
      if (seen[p.id] || now - p.createdAt > REPORT_MAX_AGE_MS || p.isOwn || !isNotableReport(p)) continue;
      const author = p.author.username.toLowerCase();
      if (author === self || muted.has(author)) continue;
      seen[p.id] = p.createdAt;
      const n = reportNotification(p, place, imperial(cfg));
      await io.notify(n);
      sent.push(n);
    }
  }
  for (const [id, t] of Object.entries(seen)) if (now - t > 86_400_000) delete seen[id];
  io.kvSet(REPORTS_KEY, JSON.stringify(seen));
  return sent;
}

/* ---------- Morning briefing ---------- */

/** "07:30" → 450; anything unreadable → 7:00. */
export function parseBriefingTime(t: string | undefined): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  const minutes = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  return Number.isFinite(minutes) && minutes >= 0 && minutes < 1440 ? minutes : 420;
}

/** The place the briefing is for: the selected location, else the first saved place. */
export function briefingPlace(cfg: WatchConfig): SavedPlace | null {
  return cfg.places.find((p) => p.id === CURRENT_PLACE_ID) ?? cfg.places[0] ?? null;
}

/** Today's summary: conditions, high/low, rain chance and when, notable gusts and UV. */
export function briefingText(f: Forecast, cfg: WatchConfig, now: number): string {
  const d = f.daily;
  const off = f.utcOffsetSeconds;
  // Today's row: the last day starting at or before now.
  let i = 0;
  for (let k = 0; k < d.time.length; k++) if (d.time[k]! * 1000 <= now) i = k;
  const parts: string[] = [];
  const code = d.code[i];
  if (code != null) parts.push(`${describeCode(code).label}.`);
  const hi = d.tMax[i];
  const lo = d.tMin[i];
  const t = (c: number) => formatTemp(c, cfg.units.temp).replace(/[FC]$/, "");
  if (hi != null && lo != null) parts.push(`High ${t(hi)}, low ${t(lo)}.`);
  else if (hi != null) parts.push(`High ${t(hi)}.`);

  const pop = d.precipProbMax[i] ?? 0;
  if (pop >= 20) {
    // The likeliest hour still ahead today.
    const end = (d.time[i + 1] ?? d.time[i]! + 86_400) * 1000;
    let best = -1;
    let bestPop = -1;
    f.hourly.time.forEach((ts, k) => {
      const ms = ts * 1000;
      const v = f.hourly.precipProb[k];
      if (ms + 3_600_000 >= now && ms < end && v != null && v > bestPop) {
        bestPop = v;
        best = ms;
      }
    });
    parts.push(pop >= 40 && best > 0 ? `${pop}% chance of rain, most likely around ${clockAt(best, off)}.` : `${pop}% chance of rain.`);
  } else {
    parts.push("Little chance of rain.");
  }
  const gust = d.gustMax[i];
  if (gust != null && gust >= 11) parts.push(`Gusts to ${formatWind(gust, cfg.units.wind)}.`);
  const uv = d.uvMax[i];
  if (uv != null && uv >= 6) parts.push(`UV ${Math.round(uv)} (${uv >= 8 ? "very high" : "high"}).`);
  return parts.join(" ");
}

/** Once a day, at or up to three hours after the chosen time on the device's clock. */
export async function checkBriefing(cfg: WatchConfig, io: ExtrasIO): Promise<AppNotification | null> {
  const opts = cfg.settings.briefing;
  if (!cfg.settings.enabled || !opts?.enabled) return null;
  const { minutes, day } = io.localClock();
  const at = parseBriefingTime(opts.time);
  if (minutes < at || minutes - at > BRIEFING_WINDOW_MIN || io.kvGet(BRIEFING_KEY) === day) return null;
  const place = briefingPlace(cfg);
  if (!place) return null;
  const f = await io.fetchForecast(place.lat, place.lon);
  io.kvSet(BRIEFING_KEY, day);
  const n: AppNotification = { id: hashId(`briefing:${day}`), title: `Today in ${place.name}`, body: briefingText(f, cfg, io.now()), kind: "briefing" };
  await io.notify(n);
  return n;
}
