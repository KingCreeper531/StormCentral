"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { qk, useSession } from "@/hooks/queries";
import { getJson } from "@/lib/api/http";
import { fetchAirQuality, fetchForecast, type Forecast } from "@/lib/api/open-meteo";
import type { AlertsResponse } from "@/lib/api/types";
import { checkRules, checkWarnings, widgetSnapshot, type EngineIO } from "@/lib/alerting/engine";
import { checkBriefing, checkLightning, checkSpotterReports, type ExtrasIO } from "@/lib/alerting/extras";
import type { BlockedUserDto, FeedResponse } from "@/lib/community";
import { nativeAlerts, nativeAlertsAvailable } from "@/lib/native/storm-alerts";
import { nativePermission, showNativeNotification } from "@/lib/alerting/notify-native";
import { PERMISSION_EVENT, showWebNotification, subscribePermission, webPermission } from "@/lib/alerting/notify-web";
import { CURRENT_PLACE_ID, type WatchConfig } from "@/lib/alerting/types";
import { readShared, syncRunner, writeShared } from "@/lib/native/runner-bridge";
import { COMMUNITY_ENABLED, isNativeApp } from "@/lib/platform";
import type { ClimateResponse } from "@/lib/feeds/climate";
import type { ForecasterNotesResponse } from "@/lib/feeds/forecaster-notes";
import { widgetNote } from "@/lib/widget-note";
import { forecastSource } from "@/lib/forecast-sources";
import { selectActiveTheme, useAddonsStore } from "@/store/addons-store";
import { useAlertsStore } from "@/store/alerts-store";
import { useAppStore, type AppLocation } from "@/store/app-store";

const WARNING_EVERY_MS = 2 * 60_000;
const RULES_EVERY_MS = 30 * 60_000;
/** Lightning, nearby reports and the briefing (each fetches only when it has something to do). */
const EXTRAS_EVERY_MS = 5 * 60_000;
const KV_PREFIX = "stormcentral:alerts:kv:";
/** Engine state shared with the Android background runner, so a warning isn't announced twice. */
const SHARED_KV_KEYS = ["seen-alerts", "fired-rules", "lightning-at", "seen-reports", "briefing-day"];

/** The engine's view of the stores: saved places plus (optionally) the selected location. */
export function useWatchConfig(): WatchConfig | null {
  const alertsHydrated = useAlertsStore((s) => s.hydrated);
  const appHydrated = useAppStore((s) => s.hydrated);
  const hydrated = alertsHydrated && appHydrated;
  const places = useAlertsStore((s) => s.places);
  const settings = useAlertsStore((s) => s.settings);
  const rules = useAlertsStore((s) => s.rules);
  const location = useAppStore((s) => s.location);
  const units = useAppStore((s) => s.units);
  const drone = useAppStore((s) => s.drone);
  // Nearby-report alerts need the spotter network, who's signed in and whom they blocked.
  const { data: session } = useSession();
  const blocked = useQuery({
    queryKey: ["blocks"],
    queryFn: ({ signal }) => getJson<{ blocked: BlockedUserDto[] }>("/api/blocks", { signal }).then((r) => r.blocked),
    enabled: COMMUNITY_ENABLED && !!session,
    staleTime: 10 * 60_000,
  }).data;
  const username = session?.username ?? null;
  const mutedKey = (blocked ?? []).map((b) => b.username).join(",");
  return useMemo(() => {
    if (!hydrated) return null;
    const usesCurrent = settings.watchCurrent || rules.some((r) => r.placeId === CURRENT_PLACE_ID);
    const watched = usesCurrent ? [{ id: CURRENT_PLACE_ID, name: location.name, lat: location.lat, lon: location.lon }, ...places] : places;
    return {
      settings,
      // Warnings for the current location only when asked; rules may still use it.
      places: watched,
      rules,
      units: { temp: units.temp, wind: units.wind },
      drone: { altitudeM: drone.altitudeM, profileId: drone.profileId },
      community:
        COMMUNITY_ENABLED && typeof window !== "undefined"
          ? { url: window.location.origin, username, muted: mutedKey ? mutedKey.split(",") : [] }
          : null,
    };
  }, [hydrated, places, settings, rules, location, units.temp, units.wind, drone.altitudeM, drone.profileId, username, mutedKey]);
}

/** The widget snapshot for the selected location from whatever the app has loaded, with today's highlight. */
export function buildWidget(qc: QueryClient, loc: AppLocation, unit: "F" | "C") {
  const now = Date.now();
  const f = qc.getQueryData<Forecast>(qk.forecast(loc)) ?? null;
  const local = qc.getQueryData<AlertsResponse>(qk.localAlerts(loc))?.alerts ?? null;
  const climate = qc.getQueryData<ClimateResponse>(qk.climate(loc)) ?? null;
  const notes = qc.getQueryData<ForecasterNotesResponse>(qk.forecasterNotes(loc)) ?? null;
  return widgetSnapshot({ id: CURRENT_PLACE_ID, name: loc.name, lat: loc.lat, lon: loc.lon }, unit, f, local, now, widgetNote(f, climate, notes, unit, now));
}

/** Warning checks skip the current location unless the user asked to watch it. */
function warningConfig(cfg: WatchConfig): WatchConfig {
  return cfg.settings.watchCurrent ? cfg : { ...cfg, places: cfg.places.filter((p) => p.id !== CURRENT_PLACE_ID) };
}

const pageIO: EngineIO = {
  now: () => Date.now(),
  // Through our own /api route: cached server-side, and in the Android bundle served in-process.
  fetchAlerts: async (lat, lon) => (await getJson<AlertsResponse>(`/api/alerts?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`)).alerts,
  fetchForecast: (lat, lon) => fetchForecast(lat, lon),
  fetchAir: (lat, lon) => fetchAirQuality(lat, lon),
  kvGet: (key) => {
    try {
      return localStorage.getItem(KV_PREFIX + key);
    } catch {
      return null;
    }
  },
  kvSet: (key, value) => {
    try {
      localStorage.setItem(KV_PREFIX + key, value);
    } catch {
      /* storage full or blocked: worst case a notification repeats */
    }
  },
  notify: (n) => showWebNotification(n),
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The newer checks in the page: the same storage and notifier as the engine, plus lightning and reports. */
function extrasIO(io: EngineIO): ExtrasIO {
  return {
    now: io.now,
    localClock: () => {
      const d = new Date();
      return { minutes: d.getHours() * 60 + d.getMinutes(), day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
    },
    fetchForecast: io.fetchForecast,
    fetchLightningKm: async (lat, lon, radiusKm) =>
      (await getJson<{ nearestKm: number | null }>(`/api/lightning?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&radiusKm=${Math.round(radiusKm)}`)).nearestKm,
    fetchNearbyReports: async (lat, lon, radiusKm) =>
      (await getJson<FeedResponse>(`/api/posts?sort=nearby&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&radiusKm=${Math.round(radiusKm)}`)).posts,
    kvGet: io.kvGet,
    kvSet: io.kvSet,
    notify: io.notify,
  };
}

/**
 * Android, app open: run the engine in the page and notify through Local
 * Notifications, reading and writing the runner's own storage so the runner
 * (which keeps checking while the app is closed) knows what was already sent.
 */
async function withNativeIO<T>(run: (io: EngineIO) => Promise<T>): Promise<T> {
  const store = new Map<string, string | null>();
  for (const k of SHARED_KV_KEYS) store.set(k, await readShared(k).catch(() => null));
  const dirty = new Set<string>();
  const io: EngineIO = {
    ...pageIO,
    kvGet: (k) => store.get(k) ?? null,
    kvSet: (k, v) => {
      store.set(k, v);
      dirty.add(k);
    },
    notify: (n) => showNativeNotification(n),
  };
  try {
    return await run(io);
  } finally {
    if (dirty.size) await writeShared(Object.fromEntries([...dirty].map((k) => [k, store.get(k) ?? ""]))).catch(() => {});
  }
}

/** Whether notifications are allowed, kept current (prompts, settings changes, returning to the app). */
function useNotificationsAllowed(native: boolean): boolean {
  const web = useSyncExternalStore(
    (cb) => (typeof window === "undefined" ? () => {} : subscribePermission(cb)),
    () => webPermission() === "granted",
    () => false,
  );
  const [nativeOk, setNativeOk] = useState(false);
  useEffect(() => {
    if (!native) return;
    let live = true;
    const read = () => void nativePermission(false).then((p) => live && setNativeOk(p === "granted"), () => {});
    read();
    window.addEventListener(PERMISSION_EVENT, read);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      window.removeEventListener(PERMISSION_EVENT, read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [native]);
  return native ? nativeOk : web;
}

/**
 * Runs the alert engine for the whole app (mounted once, in Providers).
 * - Web and Windows: checks in the page. Only one tab runs it (Web Locks), and
 *   the Windows app keeps it running while hidden in the tray.
 * - Android: mirrors the config to the background runner, which checks while
 *   the app is closed; while it's open, asks the runner to check every 5 minutes.
 */
export function AlertWatcher() {
  const cfg = useWatchConfig();
  const qc = useQueryClient();
  const cfgRef = useRef(cfg);
  useEffect(() => {
    cfgRef.current = cfg;
  });

  // ── Android: keep the runner's copy (and the widget's seed data) current ──
  const location = useAppStore((s) => s.location);
  const unit = useAppStore((s) => s.units.temp);
  useEffect(() => {
    if (!isNativeApp() || !cfg) return;
    const t = setTimeout(() => {
      void syncRunner(cfg, buildWidget(qc, location, unit))
        .catch(() => {})
        // Native notifications (0.4.3+): reschedule and check with the new settings.
        .then(() => (nativeAlertsAvailable() ? nativeAlerts.sync() : undefined))
        .catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [cfg, qc, location, unit]);

  // The widgets match the app's light/dark/system setting (a custom theme's base wins), clock and background choice.
  const themePref = useAppStore((s) => s.theme);
  const customBase = useAddonsStore((s) => selectActiveTheme(s)?.base);
  const widgetTheme = customBase ?? themePref;
  const clock = useAppStore((s) => s.clock);
  const widgetBg = useAppStore((s) => s.widgetBackground);
  const source = useAppStore((s) => s.forecastSource);
  const googleKey = useAppStore((s) => s.googleKey.trim());
  const hydrated = useAppStore((s) => s.hydrated);
  useEffect(() => {
    // After rehydration, so the saved choice isn't overwritten by the default.
    if (!isNativeApp() || !hydrated) return;
    void writeShared({
      theme: widgetTheme,
      clock,
      widgetBg,
      // The forecast source, so the widgets and the background runner use it while the app is closed.
      forecastSource: source,
      forecastModel: forecastSource(source).model ?? "",
      // Only while Google is chosen: otherwise the key has no business outside the app.
      googleKey: source === "google" ? googleKey : "",
    }).catch(() => {});
  }, [widgetTheme, clock, widgetBg, source, googleKey, hydrated]);

  // Refresh the widget whenever a new forecast, climate table or forecaster discussion lands for the selected location.
  useEffect(() => {
    if (!isNativeApp()) return;
    return qc.getQueryCache().subscribe((e) => {
      const kind = e.query.queryKey[0];
      if (e.type !== "updated" || e.action.type !== "success" || !cfgRef.current) return;
      if (kind !== "forecast" && kind !== "climate" && kind !== "forecasterNotes") return;
      const loc = useAppStore.getState().location;
      if (!qc.getQueryData<Forecast>(qk.forecast(loc))) return;
      void syncRunner(cfgRef.current, buildWidget(qc, loc, useAppStore.getState().units.temp)).catch(() => {});
    });
  }, [qc]);

  const enabled = !!cfg?.settings.enabled;
  const native = useSyncExternalStore(
    () => () => {},
    isNativeApp,
    () => false,
  );
  const allowed = useNotificationsAllowed(native);
  // Android with native notifications: Android checks everything but custom alerts, open or closed.
  const nativeChecks = useSyncExternalStore(
    () => () => {},
    nativeAlertsAvailable,
    () => false,
  );

  // ── Run the engine in the page: web, Windows, and Android while open ──
  // Starts as soon as both the setting and the permission are on (the
  // permission prompt usually answers after the switch is flipped).
  useEffect(() => {
    if (!enabled || !allowed) return;
    let stopped = false;
    let release: (() => void) | null = null;
    const timers: ReturnType<typeof setInterval>[] = [];
    const cleanups: (() => void)[] = [];

    const start = () => {
      // Android checks only while the app is in front; the runner covers the rest.
      const active = () => !native || document.visibilityState === "visible";
      const run = (fn: (io: EngineIO) => Promise<unknown>) => (native ? withNativeIO(fn) : fn(pageIO));
      const warnings = () => {
        const c = cfgRef.current;
        if (c && !stopped && active() && !nativeChecks) void run((io) => checkWarnings(warningConfig(c), io)).catch(() => {});
      };
      const extras = () => {
        const c = cfgRef.current;
        if (!c || stopped || !active() || nativeChecks) return;
        const s = c.settings;
        if (!s.briefing?.enabled && !s.lightning?.enabled && !(s.spotter?.enabled && c.community)) return;
        void run(async (io) => {
          const x = extrasIO(io);
          await checkLightning(c, x).catch(() => {});
          await checkSpotterReports(c, x).catch(() => {});
          await checkBriefing(c, x).catch(() => {});
        }).catch(() => {});
      };
      const rules = () => {
        const c = cfgRef.current;
        if (c && !stopped && active() && c.rules.some((r) => r.enabled) && c.settings.custom !== false) void run((io) => checkRules(c, io)).catch(() => {});
      };
      warnings();
      rules();
      extras();
      timers.push(setInterval(warnings, WARNING_EVERY_MS), setInterval(rules, RULES_EVERY_MS), setInterval(extras, EXTRAS_EVERY_MS));
      // Coming back to the Android app: check right away.
      if (native) {
        const onVisible = () => {
          if (document.visibilityState !== "visible") return;
          warnings();
          extras();
        };
        document.addEventListener("visibilitychange", onVisible);
        cleanups.push(() => document.removeEventListener("visibilitychange", onVisible));
      }
    };

    // One tab checks; the others wait for the lock (and take over if that tab closes).
    if (!native && typeof navigator !== "undefined" && navigator.locks) {
      void navigator.locks
        .request("stormcentral:alert-watcher", () => {
          if (stopped) return;
          start();
          return new Promise<void>((resolve) => (release = resolve));
        })
        .catch(() => {});
    } else {
      start();
    }
    return () => {
      stopped = true;
      timers.forEach(clearInterval);
      cleanups.forEach((f) => f());
      release?.();
    };
  }, [enabled, allowed, native, nativeChecks]);

  return null;
}
