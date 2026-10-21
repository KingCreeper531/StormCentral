/**
 * Alert engine: warnings and custom alerts for saved places.
 *
 * One implementation, two hosts. The page runs it on the web and in the
 * Windows app (`components/alerts/alert-watcher.tsx`). The Android background
 * runner runs it while the app is closed (`native/runner/background.ts`).
 * Everything host-specific is injected through `EngineIO`, and nothing here
 * uses Intl, the DOM or AbortSignal, which the runner's engine lacks.
 */
import type { WidgetNote } from "../widget-note";
import type { AirQuality, Forecast } from "../api/open-meteo";
import type { WeatherAlert } from "../api/types";
import { translate, translator, type Lang } from "../i18n/core";
import { eventName } from "../i18n/nws-events";
import { describeCode } from "../weather/wmo";
import { currentHourIndex, todayIndex } from "../weather/view";
import { clockAt, clockFromIso, dayKeyAt, formatTemp, hashId } from "./format";
import { describeRule, firstHit, formatMetric, metricDef, metricSeries } from "./metrics";
import type { AlertCategory, AlertRule, AppNotification, SavedPlace, WatchConfig } from "./types";
import { CURRENT_PLACE_ID } from "./types";

export interface EngineIO {
  now(): number;
  /** Active NWS alerts covering a point, normalised (lib/alerts). */
  fetchAlerts(lat: number, lon: number): Promise<WeatherAlert[]>;
  fetchForecast(lat: number, lon: number): Promise<Forecast>;
  fetchAir(lat: number, lon: number): Promise<AirQuality>;
  /** Small persistent key-value store (localStorage, or the runner's KV). */
  kvGet(key: string): string | null;
  kvSet(key: string, value: string): void;
  notify(n: AppNotification): void | Promise<void>;
  log?(message: string): void;
}

const SEEN_KEY = "seen-alerts";
/** How dangerous each seen warning was (dangerLevel), to tell an update that escalates it. */
const LEVEL_KEY = "seen-alert-levels";
const FIRED_KEY = "fired-rules";
/** At most this many warning notifications per check; the rest are marked seen. */
const MAX_PER_CHECK = 5;

function readJson<T>(io: EngineIO, key: string, fallback: T): T {
  try {
    const raw = io.kvGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Which muteable group an NWS event belongs to (first match wins). */
export function alertCategory(event: string): AlertCategory {
  const e = event.toLowerCase();
  if (e.includes("tornado")) return "tornado";
  if (/hurricane|tropical|typhoon|storm surge/.test(e)) return "tropical";
  if (e.includes("severe thunderstorm")) return "severe";
  if (e.includes("flood")) return "flood";
  if (/fire|red flag/.test(e)) return "fire";
  if (/winter|blizzard|ice storm|snow|sleet|freez|frost|wind chill|cold/.test(e)) return "winter";
  if (e.includes("heat")) return "heat";
  if (/wind|gale|dust storm/.test(e)) return "wind";
  return "other";
}

/** Warnings and emergencies; with level "all", watches, advisories and statements too. */
export function alertMatchesLevel(a: WeatherAlert, level: WatchConfig["settings"]["level"]): boolean {
  if (/test message/i.test(a.event)) return false;
  if (level === "all") return true;
  return /warning|emergency/i.test(a.event) || a.tags.some((t) => /EMERGENCY/.test(t));
}

/** "… 4:45 p. m.." → "… 4:45 p. m.": Spanish clock times already end in a period. */
const oneStop = (s: string) => s.replace(/\.\.$/, ".");

function warningNotification(a: WeatherAlert, place: SavedPlace, lang: Lang = "en"): AppNotification {
  const until = clockFromIso(a.ends ?? a.expires, lang);
  // "TORNADO POSSIBLE" → "Tornado possible", then into the person's language.
  const tags = a.tags.filter((t) => t !== "PDS").map((t) => translate(lang, t.charAt(0) + t.slice(1).toLowerCase()));
  const lead = [
    a.tags.includes("PDS") ? translate(lang, "Particularly dangerous situation.") : "",
    tags.length ? `${tags.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  const detail = (a.headline ?? a.areaDesc ?? "").replace(/\s+/g, " ").trim();
  return {
    id: hashId(`${a.id}@${place.id}`),
    title: translate(lang, "{event}: {place}", { event: eventName(lang, a.event), place: place.name }),
    body: [lead, oneStop(translate(lang, "Until {time}.", { time: until })), detail.length > 140 ? `${detail.slice(0, 137)}…` : detail].filter(Boolean).join(" "),
    kind: "warning",
  };
}

export interface WarningCheckResult {
  sent: AppNotification[];
  /** Alerts per place id, for callers that reuse them (e.g. the widget). */
  alerts: Map<string, WeatherAlert[]>;
}

/** 0 none, 1 tornado observed, 2 PDS or destructive or considerable, 3 tornado or flash flood emergency. */
export function dangerLevel(a: WeatherAlert): number {
  if (a.tags.includes("TORNADO EMERGENCY") || a.tags.includes("FLASH FLOOD EMERGENCY")) return 3;
  if (a.tags.some((t) => t === "PDS" || t === "DESTRUCTIVE" || t === "CONSIDERABLE")) return 2;
  return a.tags.includes("OBSERVED") ? 1 : 0;
}

/**
 * Notify about alerts that are new since the last check, once per alert and
 * place. NWS sends each update of a warning (every 10–20 minutes, or when it's
 * extended) with a new id that references the earlier ones: an update of one
 * already told about stays quiet, unless it got more dangerous (a tornado
 * emergency, PDS, a tornado observed).
 */
export async function checkWarnings(cfg: WatchConfig, io: EngineIO): Promise<WarningCheckResult> {
  const alerts = new Map<string, WeatherAlert[]>();
  const sent: AppNotification[] = [];
  const now = io.now();
  const seen = readJson<Record<string, number>>(io, SEEN_KEY, {});
  const levels = readJson<Record<string, number>>(io, LEVEL_KEY, {});
  const fresh: { a: WeatherAlert; place: SavedPlace }[] = [];

  for (const place of cfg.places) {
    let list: WeatherAlert[];
    try {
      list = await io.fetchAlerts(place.lat, place.lon);
    } catch (err) {
      io.log?.(`alerts for ${place.name} failed: ${String(err)}`);
      continue;
    }
    alerts.set(place.id, list);
    if (!cfg.settings.enabled) continue;
    for (const a of list) {
      const key = `${a.id}@${place.id}`;
      if (seen[key] || !alertMatchesLevel(a, cfg.settings.level) || cfg.settings.categories?.[alertCategory(a.event)] === false) continue;
      const ends = Date.parse(a.ends ?? a.expires);
      seen[key] = Number.isFinite(ends) ? ends : now + 6 * 3_600_000;
      const level = dangerLevel(a);
      const earlier = (a.references ?? []).map((r) => `${r}@${place.id}`).filter((k) => seen[k]);
      const was = earlier.length ? Math.max(...earlier.map((k) => levels[k] ?? 0)) : -1;
      levels[key] = Math.max(level, was);
      if (was >= 0 && level <= was) continue;
      if (!Number.isFinite(ends) || ends > now) fresh.push({ a, place });
    }
  }

  fresh.sort((x, y) => y.a.rank - x.a.rank);
  for (const { a, place } of fresh.slice(0, MAX_PER_CHECK)) {
    const n = warningNotification(a, place, cfg.lang ?? "en");
    await io.notify(n);
    sent.push(n);
  }
  // Forget alerts an hour after they end.
  for (const [k, ends] of Object.entries(seen)) if (ends + 3_600_000 < now) delete seen[k];
  for (const k of Object.keys(levels)) if (!(k in seen)) delete levels[k];
  io.kvSet(SEEN_KEY, JSON.stringify(seen));
  io.kvSet(LEVEL_KEY, JSON.stringify(levels));
  return { sent, alerts };
}

export interface ForecastCache {
  forecasts: Map<string, Forecast>;
  air: Map<string, AirQuality>;
}

function ruleNotification(rule: AlertRule, place: SavedPlace, hit: { t: number; v: number }, f: Forecast, cfg: WatchConfig, now: number): AppNotification {
  const lang = cfg.lang ?? "en";
  const t = translator(lang);
  const def = metricDef(rule.metric);
  const off = f.utcOffsetSeconds;
  const day = dayKeyAt(hit.t, off);
  const vars = { metric: t(def.label), value: formatMetric(def.kind, hit.v, cfg.units), time: clockAt(hit.t, off, lang) };
  const body = oneStop(
    hit.t <= now
      ? t("{metric} {value} now.", vars)
      : day === dayKeyAt(now + 86_400_000, off)
        ? t("{metric} {value} tomorrow at {time}.", vars)
        : t("{metric} {value} at {time}.", vars),
  );
  return {
    id: hashId(`rule:${rule.id}:${day}`),
    title: t("{place}: {rule}", { place: place.name, rule: describeRule(rule.metric, rule.op, rule.value, cfg.units, t) }),
    body,
    kind: "custom",
  };
}

/**
 * Evaluate enabled custom alerts. Each rule notifies at most once per local
 * day of the hour that meets it.
 */
export async function checkRules(cfg: WatchConfig, io: EngineIO, cache: ForecastCache = { forecasts: new Map(), air: new Map() }) {
  const sent: AppNotification[] = [];
  const rules = cfg.rules.filter((r) => r.enabled);
  const fired = readJson<Record<string, string>>(io, FIRED_KEY, {});
  const now = io.now();

  for (const rule of rules) {
    const place = cfg.places.find((p) => p.id === rule.placeId);
    if (!place || !cfg.settings.enabled || cfg.settings.custom === false) continue;
    try {
      let f = cache.forecasts.get(place.id);
      if (!f) {
        f = await io.fetchForecast(place.lat, place.lon);
        cache.forecasts.set(place.id, f);
      }
      let air: AirQuality | null = null;
      if (metricDef(rule.metric).air) {
        air = cache.air.get(place.id) ?? (await io.fetchAir(place.lat, place.lon));
        cache.air.set(place.id, air);
      }
      const series = metricSeries(rule.metric, { forecast: f, air, now, lat: place.lat, lon: place.lon, drone: cfg.drone }, rule.hours);
      const hit = firstHit(series, rule.op, rule.value);
      if (!hit) continue;
      const day = dayKeyAt(hit.t, f.utcOffsetSeconds);
      if (fired[rule.id] === day) continue;
      fired[rule.id] = day;
      const n = ruleNotification(rule, place, hit, f, cfg, now);
      await io.notify(n);
      sent.push(n);
    } catch (err) {
      io.log?.(`rule ${rule.id} failed: ${String(err)}`);
    }
  }
  // Drop bookkeeping for rules that no longer exist.
  for (const id of Object.keys(fired)) if (!cfg.rules.some((r) => r.id === id)) delete fired[id];
  io.kvSet(FIRED_KEY, JSON.stringify(fired));
  return { sent, cache };
}

// ─── Home-screen widget snapshot (Android) ──────────────────────────────────

/** JSON the Android widget reads (see WeatherWidgetProvider.java). */
export interface WidgetSnapshot {
  place: { name: string; lat: number; lon: number };
  unit: "F" | "C";
  now: { tempC: number; code: number; text: string; hiC: number | null; loC: number | null; isDay: boolean; time: string } | null;
  alert: { event: string; until: string } | null;
  /** Next days for the 5-day widget: the place's local date ("2026-10-07"). */
  days?: { date: string; code: number | null; hiC: number | null; loC: number | null }[];
  /** Next hours for the hourly widget, starting with the current hour (ISO instants). */
  hours?: { time: string; code: number | null; tempC: number }[];
  /** A one-line highlight widgets show when they have room ("Near-record high: 84°…"). */
  note?: WidgetNote | null;
  updated: string;
}

const WIDGET_DAYS = 5;
const WIDGET_HOURS = 6;

function widgetForecast(f: Forecast, now: number): Pick<WidgetSnapshot, "days" | "hours"> {
  const days: NonNullable<WidgetSnapshot["days"]> = [];
  for (let i = todayIndex(f, now); i < f.daily.time.length && days.length < WIDGET_DAYS; i++) {
    // daily.time is the place's local midnight; shifted by the offset it's that date in UTC. Read at midday, so a
    // day after a daylight-saving change (another offset than today's) still lands on its own date.
    const date = new Date((f.daily.time[i]! + f.utcOffsetSeconds + 43_200) * 1000).toISOString().slice(0, 10);
    days.push({ date, code: f.daily.code[i] ?? null, hiC: f.daily.tMax[i] ?? null, loC: f.daily.tMin[i] ?? null });
  }
  const hours: NonNullable<WidgetSnapshot["hours"]> = [];
  for (let i = currentHourIndex(f, now); i < f.hourly.time.length && hours.length < WIDGET_HOURS; i++) {
    const tempC = f.hourly.temp[i];
    if (tempC == null) continue;
    hours.push({ time: new Date(f.hourly.time[i]! * 1000).toISOString(), code: f.hourly.code[i] ?? null, tempC });
  }
  return { days, hours };
}

export function widgetSnapshot(
  place: SavedPlace,
  unit: "F" | "C",
  f: Forecast | null,
  alerts: WeatherAlert[] | null,
  now: number,
  note: WidgetNote | null = null,
  /** Language of the condition text (`now.text`). */
  lang: Lang = "en",
): WidgetSnapshot {
  const top = (alerts ?? []).filter((a) => Date.parse(a.ends ?? a.expires) > now).sort((a, b) => b.rank - a.rank)[0];
  let current: WidgetSnapshot["now"] = null;
  if (f && f.current.temp != null) {
    const di = todayIndex(f, now);
    const code = f.current.code ?? f.hourly.code[currentHourIndex(f, now)] ?? 0;
    current = {
      tempC: f.current.temp,
      code,
      text: translate(lang, describeCode(code).label),
      hiC: f.daily.tMax[di] ?? null,
      loC: f.daily.tMin[di] ?? null,
      isDay: (f.current.isDay ?? 1) === 1,
      time: new Date(f.current.time * 1000).toISOString(),
    };
  }
  return {
    place: { name: place.name, lat: place.lat, lon: place.lon },
    unit,
    now: current,
    alert: top ? { event: top.event, until: top.ends ?? top.expires } : null,
    ...(f ? widgetForecast(f, now) : {}),
    note: note && Date.parse(note.until) > now ? note : null,
    updated: new Date(now).toISOString(),
  };
}

/**
 * The background runner can't compute highlights (no climate or NWS text), so
 * it keeps the app's last one for the same place while it's still current.
 */
export function carryNote(prev: WidgetSnapshot | null, place: { lat: number; lon: number }, now: number): WidgetNote | null {
  const n = prev?.note;
  if (!n || !prev || Math.abs(prev.place.lat - place.lat) > 1e-4 || Math.abs(prev.place.lon - place.lon) > 1e-4) return null;
  return Date.parse(n.until) > now ? n : null;
}

/** One-line summary for logs and tests. */
export function describeSnapshot(s: WidgetSnapshot): string {
  return s.now ? `${s.place.name}: ${formatTemp(s.now.tempC, s.unit)}, ${s.now.text}` : `${s.place.name}: no data`;
}

export { CURRENT_PLACE_ID };
