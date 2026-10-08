"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { qk } from "@/hooks/queries";
import { getJson } from "@/lib/api/http";
import { fetchAirQuality, fetchForecast, type Forecast } from "@/lib/api/open-meteo";
import type { AlertsResponse } from "@/lib/api/types";
import { checkRules, checkWarnings, widgetSnapshot, type EngineIO } from "@/lib/alerting/engine";
import { showWebNotification, webPermission } from "@/lib/alerting/notify-web";
import { CURRENT_PLACE_ID, type WatchConfig } from "@/lib/alerting/types";
import { runnerCheck, syncRunner } from "@/lib/native/runner-bridge";
import { isNativeApp } from "@/lib/platform";
import { useAlertsStore } from "@/store/alerts-store";
import { useAppStore } from "@/store/app-store";

const WARNING_EVERY_MS = 2 * 60_000;
const RULES_EVERY_MS = 30 * 60_000;
/** While the Android app is open, ask the runner to check this often. */
const NATIVE_CHECK_EVERY_MS = 5 * 60_000;
const KV_PREFIX = "stormcentral:alerts:kv:";

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
    };
  }, [hydrated, places, settings, rules, location, units.temp, units.wind, drone.altitudeM, drone.profileId]);
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
      const f = qc.getQueryData<Forecast>(qk.forecast(location)) ?? null;
      const local = qc.getQueryData<AlertsResponse>(qk.localAlerts(location))?.alerts ?? null;
      const widget = widgetSnapshot({ id: CURRENT_PLACE_ID, name: location.name, lat: location.lat, lon: location.lon }, unit, f, local, Date.now());
      void syncRunner(cfg, widget).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [cfg, qc, location, unit]);

  // Refresh the widget whenever a new forecast lands for the selected location.
  useEffect(() => {
    if (!isNativeApp()) return;
    return qc.getQueryCache().subscribe((e) => {
      if (e.type !== "updated" || e.query.queryKey[0] !== "forecast" || !cfgRef.current) return;
      const loc = useAppStore.getState().location;
      const f = qc.getQueryData<Forecast>(qk.forecast(loc));
      if (!f || e.query.state.data !== f) return;
      const local = qc.getQueryData<AlertsResponse>(qk.localAlerts(loc))?.alerts ?? null;
      const widget = widgetSnapshot({ id: CURRENT_PLACE_ID, name: loc.name, lat: loc.lat, lon: loc.lon }, useAppStore.getState().units.temp, f, local, Date.now());
      void syncRunner(cfgRef.current, widget).catch(() => {});
    });
  }, [qc]);

  const enabled = !!cfg?.settings.enabled;
  useEffect(() => {
    if (!isNativeApp() || !enabled) return;
    const tick = () => document.visibilityState === "visible" && void runnerCheck().catch(() => {});
    const first = setTimeout(tick, 5_000);
    const id = setInterval(tick, NATIVE_CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [enabled]);

  // ── Web and Windows: run the engine here ──
  useEffect(() => {
    if (isNativeApp() || !enabled || webPermission() !== "granted") return;
    let stopped = false;
    let release: (() => void) | null = null;
    const timers: ReturnType<typeof setInterval>[] = [];

    const start = () => {
      const warnings = () => {
        const c = cfgRef.current;
        if (c && !stopped) void checkWarnings(warningConfig(c), pageIO).catch(() => {});
      };
      const rules = () => {
        const c = cfgRef.current;
        if (c && !stopped && c.rules.some((r) => r.enabled)) void checkRules(c, pageIO).catch(() => {});
      };
      warnings();
      rules();
      timers.push(setInterval(warnings, WARNING_EVERY_MS), setInterval(rules, RULES_EVERY_MS));
    };

    // One tab checks; the others wait for the lock (and take over if that tab closes).
    if (typeof navigator !== "undefined" && navigator.locks) {
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
      release?.();
    };
  }, [enabled]);

  return null;
}
