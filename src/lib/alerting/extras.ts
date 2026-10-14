/**
 * The newer notifications: lightning nearby, severe spotter reports nearby,
 * the morning briefing, rain about to start, storms heading your way and
 * activity on your own reports. On the web and in the Windows app the page
 * runs these (components/alerts/alert-watcher.tsx); Android runs the same
 * checks natively (android/.../AlertsWorker.java) so they work with the app
 * closed. Keep the wording (English and Spanish) of the two in step.
 */
import type { Forecast } from "../api/open-meteo";
import type { ActivityItem, PostDto } from "../community";
import { translate, translatePlural, type Vars } from "../i18n/core";
import type { IncomingStorm } from "../storm-eta";
import { precipKind, rainOutlook, roundMinutes, type PrecipKind, type RainIntensity } from "../weather/rain-outlook";
import { describeCode } from "../weather/wmo";
import { clockAt, deviceOffsetSec, formatTemp, formatWind, hashId } from "./format";
import type { AppNotification, SavedPlace, WatchConfig } from "./types";
import { CURRENT_PLACE_ID, DEFAULT_LIGHTNING, DEFAULT_RAIN, DEFAULT_SPOTTER } from "./types";

export interface ExtrasIO {
  now(): number;
  /** The device's local clock: minutes since midnight and the calendar day ("2026-10-13"). */
  localClock(): { minutes: number; day: string };
  fetchForecast(lat: number, lon: number): Promise<Forecast>;
  /** Distance (km) to the nearest lightning in the last 15 minutes within `radiusKm`, or null. */
  fetchLightningKm(lat: number, lon: number, radiusKm: number): Promise<number | null>;
  fetchNearbyReports(lat: number, lon: number, radiusKm: number): Promise<PostDto[]>;
  /** The next 3 hours of 15-minute precipitation (epoch s, mm) and the air temperature (°C). Optional: older callers lack it. */
  fetchNowcast?(lat: number, lon: number): Promise<{ times: number[]; precip: (number | null)[]; tempC: number | null }>;
  /** Strong radar storms heading for the point within the hour. */
  fetchIncomingStorms?(lat: number, lon: number): Promise<IncomingStorm[]>;
  /** Confirmations and comments on the signed-in person's reports since `since` (epoch ms). */
  fetchActivity?(since: number): Promise<ActivityItem[]>;
  kvGet(key: string): string | null;
  kvSet(key: string, value: string): void;
  notify(n: AppNotification): void | Promise<void>;
}

const LIGHTNING_KEY = "lightning-at";
const RAIN_KEY = "rain-notified";
const RAIN_CHECKED_KEY = "rain-checked";
const STORMS_KEY = "storms-seen";
const ACTIVITY_KEY = "activity-since";
const REPORTS_KEY = "seen-reports";
const BRIEFING_KEY = "briefing-day";
export const LIGHTNING_COOLDOWN_MS = 45 * 60_000;
export const REPORT_MAX_AGE_MS = 60 * 60_000;
export const BRIEFING_WINDOW_MIN = 180;
/** Look at the rain nowcast at most this often. */
export const RAIN_EVERY_MS = 10 * 60_000;
/** One rain-soon notification per spell: none again within this long. */
export const RAIN_COOLDOWN_MS = 90 * 60_000;
/** The same storm isn't announced twice for a place within this long. */
export const STORM_REPEAT_MS = 90 * 60_000;

function readJson<T>(io: ExtrasIO, key: string, fallback: T): T {
  try {
    const raw = io.kvGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const imperial = (cfg: WatchConfig) => cfg.units.temp === "F";
const lang = (cfg: WatchConfig) => cfg.lang ?? "en";
/** Notification text in the person's language. */
const tr = (cfg: WatchConfig, en: string, vars?: Vars) => translate(lang(cfg), en, vars);

function distanceText(cfg: WatchConfig, km: number, mi: boolean) {
  const d = mi ? km / 1.609 : km;
  if (d < 1.5) return tr(cfg, mi ? "within a mile" : "within a kilometre");
  return tr(cfg, "about {n} {unit} away", { n: Math.round(d), unit: mi ? "mi" : "km" });
}

/** Places warnings are checked for (the selected location only when asked). */
function watched(cfg: WatchConfig): SavedPlace[] {
  return cfg.settings.watchCurrent ? cfg.places : cfg.places.filter((p) => p.id !== CURRENT_PLACE_ID);
}

/* ---------- Lightning ---------- */

export function lightningNotification(place: SavedPlace, km: number, mi: boolean, now: number, cfg?: WatchConfig): AppNotification {
  const c = cfg ?? ({ lang: "en" } as WatchConfig);
  return {
    id: hashId(`lightning:${place.id}:${Math.floor(now / LIGHTNING_COOLDOWN_MS)}`),
    title: tr(c, "Lightning near {place}", { place: place.name }),
    body: tr(c, "Lightning detected {distance} in the last 15 minutes. When thunder roars, go indoors.", { distance: distanceText(c, km, mi) }),
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
    const n = lightningNotification(place, km, imperial(cfg), now, cfg);
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

export function reportNotification(p: PostDto, place: SavedPlace, mi: boolean, cfg?: WatchConfig): AppNotification {
  const c = cfg ?? ({ lang: "en" } as WatchConfig);
  const what = tr(c, SEVERE[p.category] ?? (p.severity >= 3 ? "Dangerous weather" : "Significant weather"));
  const km = p.distanceKm ?? 0;
  const d = mi ? km / 1.609 : km;
  const text = p.body.replace(/\s+/g, " ").trim();
  return {
    id: hashId(`report:${p.id}`),
    title:
      d < 1
        ? tr(c, "{what} reported nearby", { what })
        : tr(c, "{what} reported {n} {unit} from {place}", { what, n: Math.round(d), unit: mi ? "mi" : "km", place: place.name }),
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
      const n = reportNotification(p, place, imperial(cfg), cfg);
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
  if (code != null) parts.push(`${tr(cfg, describeCode(code).label)}.`);
  const hi = d.tMax[i];
  const lo = d.tMin[i];
  const t = (c: number) => formatTemp(c, cfg.units.temp).replace(/[FC]$/, "");
  if (hi != null && lo != null) parts.push(tr(cfg, "High {hi}, low {lo}.", { hi: t(hi), lo: t(lo) }));
  else if (hi != null) parts.push(tr(cfg, "High {hi}.", { hi: t(hi) }));

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
    parts.push(
      pop >= 40 && best > 0
        ? tr(cfg, "{pop}% chance of rain, most likely around {time}.", { pop, time: clockAt(best, off, lang(cfg)) })
        : tr(cfg, "{pop}% chance of rain.", { pop }),
    );
  } else {
    parts.push(tr(cfg, "Little chance of rain."));
  }
  const gust = d.gustMax[i];
  if (gust != null && gust >= 11) parts.push(tr(cfg, "Gusts to {wind}.", { wind: formatWind(gust, cfg.units.wind) }));
  const uv = d.uvMax[i];
  if (uv != null && uv >= 6) parts.push(tr(cfg, uv >= 8 ? "UV {uv} (very high)." : "UV {uv} (high).", { uv: Math.round(uv) }));
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
  const n: AppNotification = { id: hashId(`briefing:${day}`), title: tr(cfg, "Today in {place}", { place: place.name }), body: briefingText(f, cfg, io.now()), kind: "briefing" };
  await io.notify(n);
  return n;
}

/* ---------- Rain starting soon ---------- */

const RAIN_TITLE: Record<PrecipKind, [string, string]> = {
  rain: ["Rain starting in about {n} min", "Rain starting in a few minutes"],
  snow: ["Snow starting in about {n} min", "Snow starting in a few minutes"],
  mix: ["Rain or snow starting in about {n} min", "Rain or snow starting in a few minutes"],
};
const RAIN_WHAT: Record<PrecipKind, Record<RainIntensity, string>> = {
  rain: { light: "Light rain", moderate: "Moderate rain", heavy: "Heavy rain" },
  snow: { light: "Light snow", moderate: "Moderate snow", heavy: "Heavy snow" },
  mix: { light: "Light rain or snow", moderate: "Rain or snow", heavy: "Heavy rain or snow" },
};

/** "Rain starting in about 20 min" / "Light rain at Norman, OK, lasting about 45 min." */
export function rainNotification(
  cfg: WatchConfig,
  place: SavedPlace,
  o: { startsInMin: number; endsInMin: number | null; intensity: RainIntensity; horizonMin: number },
  kind: PrecipKind,
  startAt: number,
): AppNotification {
  const [soon, now] = RAIN_TITLE[kind];
  const title = o.startsInMin < 5 ? tr(cfg, now) : tr(cfg, soon, { n: roundMinutes(o.startsInMin) });
  const what = tr(cfg, RAIN_WHAT[kind][o.intensity]);
  const lasts = o.endsInMin == null ? null : o.endsInMin - o.startsInMin;
  const body =
    lasts == null
      ? tr(cfg, "{what} at {place}, lasting at least {h} hours.", { what, place: place.name, h: Math.max(1, Math.round((o.horizonMin - o.startsInMin) / 60)) })
      : tr(cfg, "{what} at {place}, lasting about {n} min.", { what, place: place.name, n: roundMinutes(Math.max(15, lasts)) });
  return { id: hashId(`rain:${place.id}:${Math.round(startAt / 900_000)}`), title, body, kind: "rain" };
}

/** At your location (as the briefing picks it): when rain is about to start, once per spell. */
export async function checkRainSoon(cfg: WatchConfig, io: ExtrasIO): Promise<AppNotification | null> {
  const opts = cfg.settings.rain;
  if (!cfg.settings.enabled || !opts?.enabled || !io.fetchNowcast) return null;
  const now = io.now();
  if (now - Number(io.kvGet(RAIN_CHECKED_KEY) ?? 0) < RAIN_EVERY_MS) return null;
  const place = briefingPlace(cfg);
  if (!place) return null;
  const nc = await io.fetchNowcast(place.lat, place.lon);
  io.kvSet(RAIN_CHECKED_KEY, String(now));
  const o = rainOutlook(nc.times, nc.precip, now);
  const lead = opts.leadMin || DEFAULT_RAIN.leadMin;
  if (!o || o.state !== "starting" || o.startsInMin == null || o.startsInMin > lead) return null;
  const last = readJson<{ at: number }>(io, RAIN_KEY, { at: 0 });
  if (now - last.at < RAIN_COOLDOWN_MS) return null;
  const startAt = now + o.startsInMin * 60_000;
  const n = rainNotification(cfg, place, { ...o, startsInMin: o.startsInMin }, precipKind(nc.tempC), startAt);
  io.kvSet(RAIN_KEY, JSON.stringify({ at: now }));
  await io.notify(n);
  return n;
}

/* ---------- Storms heading your way ---------- */

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;
export const compassWord = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

/** Title by what the radar sees; body with arrival time, hail and motion. */
export function stormNotification(cfg: WatchConfig, place: SavedPlace, s: IncomingStorm): AppNotification {
  const time = clockAt(s.arrivesAt, deviceOffsetSec(s.arrivesAt), lang(cfg));
  const n = Math.max(1, s.etaMin);
  const vars = { place: place.name };
  const title = s.tvs
    ? tr(cfg, "Storm with rotation heading for {place}", vars)
    : (s.meso ?? 0) > 0 && s.level >= 3
      ? tr(cfg, "Rotating storm heading for {place}", vars)
      : (s.maxHailIn ?? 0) >= 1 || s.level === 2
        ? tr(cfg, "Hailstorm heading for {place}", vars)
        : tr(cfg, "Strong storm heading for {place}", vars);
  const parts = [tr(cfg, "Arriving around {time} (in about {n} min).", { time, n: roundMinutes(n) })];
  if (s.maxHailIn && s.maxHailIn >= 0.5) {
    const size = imperial(cfg) ? `${Math.round(s.maxHailIn * 100) / 100} in` : `${Math.round(s.maxHailIn * 25.4)} mm`;
    parts.push(tr(cfg, "Hail up to {size} possible.", { size }));
  }
  if (s.speedKt >= 3) {
    parts.push(tr(cfg, "Moving {dir} at {speed}.", { dir: tr(cfg, compassWord(s.headingDeg)), speed: formatWind(s.speedKt / 1.943844, cfg.units.wind) }));
  }
  if (s.tvs) parts.push(tr(cfg, "Watch for a tornado warning and be ready to take shelter."));
  return { id: hashId(`storm:${place.id}:${s.id}`), title, body: parts.join(" "), kind: "storm" };
}

/** For each watched place, the soonest strong storm arriving within the hour, announced once. */
export async function checkStorms(cfg: WatchConfig, io: ExtrasIO): Promise<AppNotification[]> {
  const fetchStorms = io.fetchIncomingStorms;
  if (!cfg.settings.enabled || !cfg.settings.storms?.enabled || !fetchStorms) return [];
  const now = io.now();
  const seen = readJson<Record<string, number>>(io, STORMS_KEY, {});
  const sent: AppNotification[] = [];
  for (const place of watched(cfg)) {
    const storms: IncomingStorm[] = await fetchStorms(place.lat, place.lon).catch(() => []);
    const s: IncomingStorm | undefined = storms[0];
    if (!s) continue;
    const key = `${place.id}:${s.id}`;
    if (now - (seen[key] ?? 0) < STORM_REPEAT_MS) continue;
    seen[key] = now;
    const n = stormNotification(cfg, place, s);
    await io.notify(n);
    sent.push(n);
  }
  for (const [k, t] of Object.entries(seen)) if (now - t > 6 * 3_600_000) delete seen[k];
  io.kvSet(STORMS_KEY, JSON.stringify(seen));
  return sent;
}

/* ---------- Activity on your reports ---------- */

export function activityNotification(cfg: WatchConfig, a: ActivityItem): AppNotification {
  const who = a.actor.displayName || a.actor.username;
  const what = a.postPreview.length > 60 ? `${a.postPreview.slice(0, 57)}…` : a.postPreview;
  if (a.kind === "confirm") {
    return {
      id: hashId(`activity:${a.id}`),
      title: tr(cfg, "{who} confirmed your report", { who }),
      body: what ? `“${what}”` : tr(cfg, "Your report is being confirmed by spotters nearby."),
      kind: "activity",
    };
  }
  const text = (a.text ?? "").replace(/\s+/g, " ").trim();
  return {
    id: hashId(`activity:${a.id}`),
    title: tr(cfg, "{who} commented on your report", { who }),
    body: text.length > 140 ? `${text.slice(0, 137)}…` : text,
    kind: "activity",
  };
}

/** Confirmations and comments since the last check, at most 5 at once (then one summary). */
export async function checkActivity(cfg: WatchConfig, io: ExtrasIO): Promise<AppNotification[]> {
  if (!cfg.settings.enabled || !cfg.settings.activity?.enabled || !cfg.community?.username || !io.fetchActivity) return [];
  const now = io.now();
  const raw = io.kvGet(ACTIVITY_KEY);
  // First run: start from now instead of announcing old activity.
  if (!raw) {
    io.kvSet(ACTIVITY_KEY, String(now));
    return [];
  }
  const items = (await io.fetchActivity(Number(raw) || now)).sort((a, b) => a.at - b.at);
  const latest = items.reduce((m, a) => Math.max(m, a.at), Number(raw) || 0);
  io.kvSet(ACTIVITY_KEY, String(Math.max(latest, Number(raw) || 0)));
  if (!items.length) return [];
  const sent: AppNotification[] = [];
  if (items.length > 5) {
    const n: AppNotification = {
      id: hashId(`activity:batch:${latest}`),
      title: translatePlural(lang(cfg), items.length, "{n} new reaction to your reports", "{n} new reactions to your reports"),
      body: tr(cfg, "Open Storm Central to see who confirmed or commented."),
      kind: "activity",
    };
    await io.notify(n);
    return [n];
  }
  for (const a of items) {
    const n = activityNotification(cfg, a);
    await io.notify(n);
    sent.push(n);
  }
  return sent;
}
