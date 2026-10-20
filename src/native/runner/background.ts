/**
 * Android background runner (Capacitor Background Runner).
 *
 * A headless JavaScript context, separate from the web view, that Android
 * wakes about every 15 minutes, even while Storm Central is closed. It runs the
 * same alert engine as the page and refreshes the home-screen widget's data.
 * Built to out/runners/background.js by scripts/build-native.mjs (esbuild).
 *
 * The runner has fetch, timers, console and Capacitor's KV/notification APIs,
 * but no DOM, Intl, URLSearchParams or AbortSignal, so only runner-safe
 * modules may be imported here (lib/alerting, lib/alerts, open-meteo parsing,
 * lib/forecast-sources, lib/google-weather).
 * Its KV store is the SharedPreferences file named after the runner label,
 * which is also what the widget (WeatherWidgetProvider.java) reads.
 */
import { normalizeAlerts, type RawAlertFeature } from "../../lib/alerts";
import { airQualityUrl, forecastUrl, parseAirQuality, parseForecast } from "../../lib/api/open-meteo";
import { checkRules, checkWarnings, widgetSnapshot, carryNote, type EngineIO, type WidgetSnapshot } from "../../lib/alerting/engine";
import { CURRENT_PLACE_ID, type AppNotification, type WatchConfig } from "../../lib/alerting/types";
import { hasForecastData } from "../../lib/forecast-sources";
import { fetchGoogleForecast } from "../../lib/google-weather";

declare const CapacitorKV: {
  get(key: string): { value?: string | null } | null | undefined;
  set(key: string, value: string): void;
};
declare const CapacitorNotifications: { schedule(options: object[]): void };
type Handler = (resolve: (value?: unknown) => void, reject: (reason?: unknown) => void, args: Record<string, unknown> | undefined) => void;
declare function addEventListener(event: string, handler: Handler): void;

const USER_AGENT = "StormCentral/0.1 (github.com/KingCreeper531/StormCentral)";

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers } });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  return res.json();
}

function kvGet(key: string): string | null {
  try {
    return CapacitorKV.get(key)?.value ?? null;
  } catch {
    return null;
  }
}

function notify(n: AppNotification) {
  CapacitorNotifications.schedule([
    {
      id: n.id,
      title: n.title,
      body: n.body,
      largeBody: n.body,
      smallIcon: "ic_stat_stormcentral",
      autoCancel: true,
      group: n.kind === "warning" ? "warnings" : "alerts",
    },
  ]);
}

const io: EngineIO = {
  now: () => Date.now(),
  fetchAlerts: async (lat, lon) => {
    const raw = (await getJson(`https://api.weather.gov/alerts/active?status=actual&point=${lat.toFixed(3)},${lon.toFixed(3)}`, {
      Accept: "application/geo+json",
    })) as { features?: RawAlertFeature[] };
    return normalizeAlerts(raw.features ?? []);
  },
  fetchForecast: (lat, lon) => fetchChosen(lat, lon),
  fetchAir: async (lat, lon) => parseAirQuality(await getJson(airQualityUrl(lat, lon))),
  kvGet,
  kvSet: (key, value) => CapacitorKV.set(key, value),
  notify,
  log: (m) => console.log(`[stormcentral] ${m}`),
};

async function fetchBest(lat: number, lon: number, model: string | null = null) {
  try {
    return parseForecast(await getJson(forecastUrl(lat, lon, "full", model)));
  } catch {
    return parseForecast(await getJson(forecastUrl(lat, lon, "core", model)));
  }
}

/** The forecast model chosen in the app ("Forecast from"), falling back to the best match where it has nothing. */
async function fetchChosen(lat: number, lon: number) {
  const model = kvGet("forecastModel") || null;
  if (model) {
    try {
      const f = await fetchBest(lat, lon, model);
      if (hasForecastData(f.hourly, Date.now())) return { ...f, source: kvGet("forecastSource") ?? undefined };
    } catch {
      /* the best match below */
    }
  }
  return fetchBest(lat, lon);
}

/** Google's free tier is per key: while the app is closed, refresh the widget from Google at most hourly. */
const GOOGLE_EVERY_MS = 60 * 60_000;

function readConfig(): WatchConfig | null {
  try {
    const raw = kvGet("config");
    return raw ? (JSON.parse(raw) as WatchConfig) : null;
  } catch {
    return null;
  }
}

/** Warnings for every watched place, custom alerts, then the widget's snapshot. */
async function check() {
  const cfg = readConfig();
  if (!cfg) return;
  const warnCfg = cfg.settings.watchCurrent ? cfg : { ...cfg, places: cfg.places.filter((p) => p.id !== CURRENT_PLACE_ID) };
  // App 0.4.3+ notifies about warnings natively (AlertsWorker.java); then this only gathers them for the widget.
  const native = kvGet("native-last-run") != null || kvGet("nativeAlerts") === "1";
  const { alerts } = await checkWarnings(native ? { ...warnCfg, settings: { ...warnCfg.settings, enabled: false } } : warnCfg, io);
  const { cache } = await checkRules(cfg, io);

  // The widget follows the app's selected location.
  const prev = (() => {
    try {
      return JSON.parse(kvGet("widget") ?? "null") as WidgetSnapshot | null;
    } catch {
      return null;
    }
  })();
  const place = cfg.places.find((p) => p.id === CURRENT_PLACE_ID) ?? (prev ? { id: CURRENT_PLACE_ID, ...prev.place } : null);
  if (!place) return;
  let f = cache.forecasts.get(place.id) ?? (await io.fetchForecast(place.lat, place.lon).catch(() => null));
  const placeAlerts = alerts.get(place.id) ?? (await io.fetchAlerts(place.lat, place.lon).catch(() => null));
  const now = Date.now();
  const note = carryNote(prev, place, now);

  // Google chosen: its forecast over the model one, hourly at most; in between, keep the last forecast and refresh only the warning.
  const key = kvGet("forecastSource") === "google" ? kvGet("googleKey") : null;
  if (key) {
    const samePlace = prev && Math.abs(prev.place.lat - place.lat) < 1e-4 && Math.abs(prev.place.lon - place.lon) < 1e-4;
    const last = Number(kvGet("widgetGoogleAt") ?? 0);
    if (samePlace && prev?.now && now - last < GOOGLE_EVERY_MS) {
      const fresh = widgetSnapshot(place, prev.unit, null, placeAlerts, now, note, cfg.lang ?? "en");
      CapacitorKV.set("widget", JSON.stringify({ ...fresh, now: prev.now, days: prev.days, hours: prev.hours, updated: prev.updated }));
      return;
    }
    if (f) {
      try {
        f = await fetchGoogleForecast(key, f);
        CapacitorKV.set("widgetGoogleAt", String(now));
      } catch {
        /* a rejected key or no network: the model forecast */
      }
    }
  }

  const snapshot = widgetSnapshot(place, prev?.unit ?? cfg.units.temp, f, placeAlerts, now, note, cfg.lang ?? "en");
  CapacitorKV.set("widget", JSON.stringify(snapshot));
}

addEventListener("sync", (resolve, reject, args) => {
  try {
    if (args?.config) CapacitorKV.set("config", JSON.stringify(args.config));
    if (args?.widget) CapacitorKV.set("widget", JSON.stringify(args.widget));
    resolve();
  } catch (err) {
    reject(String(err));
  }
});

addEventListener("check", (resolve, reject) => {
  check().then(
    () => resolve(),
    (err) => reject(String(err)),
  );
});
