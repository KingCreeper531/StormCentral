/**
 * Alert engine: warnings and custom alerts for saved places.
 *
 * One implementation, two hosts. The page runs it on the web and in the
 * Windows app (`components/alerts/alert-watcher.tsx`). The Android background
 * runner runs it while the app is closed (`native/runner/background.ts`).
 * Everything host-specific is injected through `EngineIO`, and nothing here
 * uses Intl, the DOM or AbortSignal, which the runner's engine lacks.
 */
import type { AirQuality, Forecast } from "../api/open-meteo";
import type { WeatherAlert } from "../api/types";
import { describeCode } from "../weather/wmo";
import { currentHourIndex, todayIndex } from "../weather/view";
import { clockAt, clockFromIso, dayKeyAt, formatTemp, hashId } from "./format";
import { describeRule, firstHit, formatMetric, metricDef, metricSeries } from "./metrics";
import type { AlertRule, AppNotification, SavedPlace, WatchConfig } from "./types";
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

/** Warnings and emergencies; with level "all", watches, advisories and statements too. */
export function alertMatchesLevel(a: WeatherAlert, level: WatchConfig["settings"]["level"]): boolean {
  if (/test message/i.test(a.event)) return false;
  if (level === "all") return true;
  return /warning|emergency/i.test(a.event) || a.tags.some((t) => /EMERGENCY/.test(t));
}

function warningNotification(a: WeatherAlert, place: SavedPlace): AppNotification {
  const until = clockFromIso(a.ends ?? a.expires);
  const tags = a.tags.filter((t) => t !== "PDS").map((t) => t.charAt(0) + t.slice(1).toLowerCase());
  const lead = [a.tags.includes("PDS") ? "Particularly dangerous situation." : "", tags.length ? `${tags.join(", ")}.` : ""].filter(Boolean).join(" ");
  const detail = (a.headline ?? a.areaDesc ?? "").replace(/\s+/g, " ").trim();
  return {
    id: hashId(`${a.id}@${place.id}`),
    title: `${a.event}: ${place.name}`,
    body: [lead, `Until ${until}.`, detail.length > 140 ? `${detail.slice(0, 137)}…` : detail].filter(Boolean).join(" "),
    kind: "warning",
  };
}

export interface WarningCheckResult {
  sent: AppNotification[];
  /** Alerts per place id, for callers that reuse them (e.g. the widget). */
  alerts: Map<string, WeatherAlert[]>;
}

/** Notify about alerts that are new since the last check, once per alert and place. */
export async function checkWarnings(cfg: WatchConfig, io: EngineIO): Promise<WarningCheckResult> {
  const alerts = new Map<string, WeatherAlert[]>();
  const sent: AppNotification[] = [];
  const now = io.now();
  const seen = readJson<Record<string, number>>(io, SEEN_KEY, {});
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
      if (seen[key] || !alertMatchesLevel(a, cfg.settings.level)) continue;
      const ends = Date.parse(a.ends ?? a.expires);
      seen[key] = Number.isFinite(ends) ? ends : now + 6 * 3_600_000;
      if (!Number.isFinite(ends) || ends > now) fresh.push({ a, place });
    }
  }

  fresh.sort((x, y) => y.a.rank - x.a.rank);
  for (const { a, place } of fresh.slice(0, MAX_PER_CHECK)) {
    const n = warningNotification(a, place);
    await io.notify(n);
    sent.push(n);
  }
  // Forget alerts an hour after they end.
  for (const [k, ends] of Object.entries(seen)) if (ends + 3_600_000 < now) delete seen[k];
  io.kvSet(SEEN_KEY, JSON.stringify(seen));
  return { sent, alerts };
}

export interface ForecastCache {
  forecasts: Map<string, Forecast>;
  air: Map<string, AirQuality>;
}

function ruleNotification(rule: AlertRule, place: SavedPlace, hit: { t: number; v: number }, f: Forecast, cfg: WatchConfig, now: number): AppNotification {
  const def = metricDef(rule.metric);
  const off = f.utcOffsetSeconds;
  const day = dayKeyAt(hit.t, off) === dayKeyAt(now, off) ? "" : dayKeyAt(hit.t, off) === dayKeyAt(now + 86_400_000, off) ? "tomorrow " : "";
  const when = hit.t <= now ? "now" : `${day}at ${clockAt(hit.t, off)}`;
  return {
    id: hashId(`rule:${rule.id}:${dayKeyAt(hit.t, off)}`),
    title: `${place.name}: ${describeRule(rule.metric, rule.op, rule.value, cfg.units)}`,
    body: `${def.label} ${formatMetric(def.kind, hit.v, cfg.units)} ${when}.`,
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
    if (!place || !cfg.settings.enabled) continue;
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
  updated: string;
}

export function widgetSnapshot(place: SavedPlace, unit: "F" | "C", f: Forecast | null, alerts: WeatherAlert[] | null, now: number): WidgetSnapshot {
  const top = (alerts ?? []).filter((a) => Date.parse(a.ends ?? a.expires) > now).sort((a, b) => b.rank - a.rank)[0];
  let current: WidgetSnapshot["now"] = null;
  if (f && f.current.temp != null) {
    const di = todayIndex(f, now);
    const code = f.current.code ?? f.hourly.code[currentHourIndex(f, now)] ?? 0;
    current = {
      tempC: f.current.temp,
      code,
      text: describeCode(code).label,
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
    updated: new Date(now).toISOString(),
  };
}

/** One-line summary for logs and tests. */
export function describeSnapshot(s: WidgetSnapshot): string {
  return s.now ? `${s.place.name}: ${formatTemp(s.now.tempC, s.unit)}, ${s.now.text}` : `${s.place.name}: no data`;
}

export { CURRENT_PLACE_ID };
