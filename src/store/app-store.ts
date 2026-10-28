"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { OutlookKind } from "@/lib/api/types";
import type { LatLon } from "@/lib/geo";
import { ALERT_CATEGORIES, type AlertCategory } from "@/lib/alerts";
import type { ProductFamily, TiltPrefix } from "@/lib/radar/products";
import type { Speed } from "@/lib/radar/playback";
import { isSnowMap, isSnowThreshold, type SnowMap, type SnowThreshold } from "@/lib/radar/snow";
import { DEFAULT_FORECAST_SOURCE, isForecastSourceId, type ForecastSourceId } from "@/lib/forecast-sources";
import { defaultDailyLayout, normalizeDailyLayout, type DailyItem } from "@/lib/daily-layout";
import { isValidClock, isValidZone, setTimePrefs, type ClockPref, type ZonePref } from "@/lib/clock";
import { isLangPref, type LangPref } from "@/lib/i18n/lang";
import { DEFAULT_RING_STEP, isRingStep, type RingStep } from "@/lib/range-rings";
import type { ThemePref } from "@/lib/theme";
import { defaultUnitsForLocale, UNIT_PRESETS, type UnitPrefs } from "@/lib/weather/units";
import { isModeId, type ModeId } from "@/modes/registry";

export interface AppLocation extends LatLon {
  name: string;
  source: "default" | "search" | "gps" | "url";
}

export interface RadarSettings {
  source: "mosaic" | "site";
  /** ICAO id of the selected WSR-88D (null = nearest to location). */
  site: string | null;
  family: ProductFamily;
  tilt: TiltPrefix;
  frames: number;
  speed: Speed;
  opacity: number;
  crossfade: boolean;
  showWarnings: boolean;
  showOutlook: boolean;
  /** Which SPC Day 1 outlook the outlook overlay shows. */
  outlookKind: OutlookKind;
  /** Community spotter reports. */
  showReports: boolean;
  /** Official NWS local storm reports. */
  showStormReports: boolean;
  /** NEXRAD storm-cell attributes: hail size, rotation, motion. */
  showCells: boolean;
  /** GOES satellite imagery under the radar. */
  satellite: SatelliteBand;
  /** Cloud-free satellite pictures of the ground in place of the plain basemap (lib/radar/satellite-map). */
  satelliteMap: boolean;
  /** Active tropical cyclones: NHC cone, track and forecast points. */
  showTropical: boolean;
  showSites: boolean;
  showTracks: boolean;
  /** HRRR model forecast frames after the live loop (national mosaic). */
  future: boolean;
  /** Future radar: the newest reflectivity scan extrapolated an hour ahead (lib/radar/nowcast). */
  nowcast: boolean;
  /** NOAA lightning strike density. */
  showLightning: boolean;
  /** Blend radar pixels when zoomed in (velocity and dual-pol stay sharp). */
  smooth: boolean;
  /** Loop history: the latest scans back to back, or spread over 2 or 4 hours. */
  history: RadarHistory;
  /** Warnings tab: square tiles or the dense list. */
  warningsView: "squares" | "list";
  /** Warnings tab: within the search radius, or every active warning in the US. */
  warningsScope: "nearby" | "all";
  /**
   * Which other hazard polygons the radar maps draw besides storm-based
   * warnings (those always show with the warnings overlay): zone/county
   * warnings, watches, advisories, statements, marine products, SPC/WPC
   * discussions.
   */
  alertKinds: AlertCategory[];
  /** Warnings from other countries' weather services (Canada, Germany). */
  intlAlerts: boolean;
  /** Radar composites from other countries' weather services, time-matched to the loop. */
  intlRadar: boolean;
  /** Unofficial warnings issued by spotters with Professional mode's WarnGen (signed-in members only). */
  showSpotterWarnings: boolean;
  /** Storm chasers sharing their live position (signed-in members only). Off unless turned on. */
  showChasers: boolean;
  /** Live traffic, wildfire, river and volcano cameras (lib/webcams). Off unless turned on. */
  showCams: boolean;
  /** Range rings around the selected radar site (else the location), every `ringStep` of the distance unit. Off unless turned on. */
  showRings: boolean;
  ringStep: RingStep;
  /** Bearing lines every 30° across the range rings. */
  ringSpokes: boolean;
  /** Snow under the radar: WPC's chance of snow for Day 1–3, or NOHRSC's depth now (lib/radar/snow). Off unless turned on. */
  snow: SnowMap;
  /** The snowfall the WPC chance is of: at least 4, 8 or 12 inches. */
  snowThreshold: SnowThreshold;
  /** NOAA NDBC buoys and coastal stations, coloured by wave height (lib/feeds/buoys). Off unless turned on. */
  showBuoys: boolean;
  /** Open-Meteo's 48-hour wave forecast over the sea (lib/api/open-meteo-marine). Off unless turned on. */
  showWaves: boolean;
  /** Aviation weather: airports by flight category, SIGMETs and AIRMETs (lib/aviation). Off unless turned on. */
  showAviation: boolean;
}

export type RadarHistory = "latest" | "2h" | "4h";

export type { OutlookKind };
export type SatelliteBand = "off" | "infrared" | "visible";

export interface DroneSettings {
  profileId: string;
  altitudeM: number;
}

export interface AppState {
  /** False until persisted state is restored (gates data fetching). */
  hydrated: boolean;
  mode: ModeId;
  previousMode: ModeId | null;
  location: AppLocation;
  units: UnitPrefs;
  /** Light, dark, or follow the system. */
  theme: ThemePref;
  radar: RadarSettings;
  drone: DroneSettings;
  airLayer: "us_aqi" | "pm2_5";
  /** How far to look for warnings, spotter reports and river gauges. */
  radiusKm: number;
  /** 12- or 24-hour clock, or the device's habit. */
  clock: ClockPref;
  /** Times in the place's zone (yours, with My location on) or always the device's. */
  timeZoneMode: ZonePref;
  /** With My location on, keep updating it as you move. */
  followLocation: boolean;
  /** Android home-screen widgets: on a solid panel, or transparent over the wallpaper. */
  widgetBackground: WidgetBackground;
  /** Where the forecast comes from (chosen at the top of the Daily page). */
  forecastSource: ForecastSourceId;
  /** The person's own Google Weather API key (kept on this device only). */
  googleKey: string;
  /** Daily page panels: order, column and visibility. */
  dailyLayout: DailyItem[];
  /** App language: a fixed one, or the device's ("auto"). */
  language: LangPref;
  /** Professional mode: adds the Pro workspace (multi-panel radar, sampling, soundings) to the modes. */
  professional: boolean;
  composerOpen: boolean;
  paletteOpen: boolean;
  setMode: (mode: ModeId) => void;
  setLocation: (loc: AppLocation) => void;
  setUnits: (u: Partial<UnitPrefs> | "imperial" | "metric") => void;
  setTheme: (t: ThemePref) => void;
  setRadar: (r: Partial<RadarSettings>) => void;
  setDrone: (d: Partial<DroneSettings>) => void;
  setAirLayer: (l: AppState["airLayer"]) => void;
  setRadiusKm: (km: number) => void;
  setClock: (c: ClockPref) => void;
  setTimeZoneMode: (z: ZonePref) => void;
  setFollowLocation: (on: boolean) => void;
  setWidgetBackground: (b: WidgetBackground) => void;
  setForecastSource: (s: ForecastSourceId) => void;
  setDailyLayout: (layout: DailyItem[]) => void;
  setGoogleKey: (key: string) => void;
  setLanguage: (l: LangPref) => void;
  setProfessional: (on: boolean) => void;
  setComposerOpen: (open: boolean) => void;
  /** Radar history: the radar views show this past time (epoch ms) instead of now, null when live. Not saved. */
  archiveAt: number | null;
  setArchiveAt: (t: number | null) => void;
  setPaletteOpen: (open: boolean) => void;
}

export type WidgetBackground = "solid" | "transparent";

/** Norman, OK — home of the Storm Prediction Center. */
/** Search radius choices: whole miles or kilometres, stored in km. */
export const RADIUS_MI = [25, 50, 100, 200, 300] as const;
export const RADIUS_KM = [50, 100, 150, 300, 500] as const;
export const DEFAULT_RADIUS_KM = 100 * 1.609344;
export const MAX_RADIUS_KM = 500;
/** River gauge searches stop here (USGS limits the area of one request). */
export const MAX_GAUGE_RADIUS_KM = 150;

export const DEFAULT_LOCATION: AppLocation = { lat: 35.2226, lon: -97.4395, name: "Norman, OK", source: "default" };

export const DEFAULT_RADAR: RadarSettings = {
  source: "mosaic",
  site: null,
  family: "reflectivity",
  tilt: "N0",
  frames: 12,
  speed: 1,
  opacity: 0.85,
  crossfade: true,
  showWarnings: true,
  showOutlook: false,
  outlookKind: "categorical",
  showReports: true,
  showStormReports: true,
  showCells: true,
  satellite: "off",
  satelliteMap: false,
  showTropical: true,
  showSites: true,
  showTracks: true,
  future: true,
  nowcast: true,
  showLightning: true,
  smooth: true,
  history: "latest",
  warningsView: "squares",
  warningsScope: "nearby",
  alertKinds: [...ALERT_CATEGORIES],
  intlAlerts: true,
  intlRadar: true,
  showSpotterWarnings: true,
  showChasers: false,
  showCams: false,
  showRings: false,
  ringStep: DEFAULT_RING_STEP,
  ringSpokes: false,
  snow: "off",
  snowThreshold: 4,
  showBuoys: false,
  showWaves: false,
  showAviation: false,
};

/** Saved radar settings made whole: defaults for anything a previous version didn't store. */
export function normalizeRadar(r: RadarSettings): RadarSettings {
  const kinds = Array.isArray(r.alertKinds) ? r.alertKinds.filter((k): k is AlertCategory => (ALERT_CATEGORIES as readonly string[]).includes(k)) : DEFAULT_RADAR.alertKinds;
  return {
    ...r,
    alertKinds: [...new Set(kinds)],
    intlAlerts: r.intlAlerts !== false,
    intlRadar: r.intlRadar !== false,
    showSpotterWarnings: r.showSpotterWarnings !== false,
    showChasers: r.showChasers === true,
    showCams: r.showCams === true,
    showRings: r.showRings === true,
    ringStep: isRingStep(r.ringStep) ? r.ringStep : DEFAULT_RING_STEP,
    ringSpokes: r.ringSpokes === true,
    snow: isSnowMap(r.snow) ? r.snow : "off",
    snowThreshold: isSnowThreshold(r.snowThreshold) ? r.snowThreshold : 4,
    showBuoys: r.showBuoys === true,
    showWaves: r.showWaves === true,
    showAviation: r.showAviation === true,
    satelliteMap: r.satelliteMap === true,
    nowcast: r.nowcast !== false,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      mode: "daily",
      previousMode: null,
      location: DEFAULT_LOCATION,
      units: { ...UNIT_PRESETS.imperial },
      theme: "system",
      radar: DEFAULT_RADAR,
      drone: { profileId: "sub250", altitudeM: 120 },
      airLayer: "us_aqi",
      radiusKm: DEFAULT_RADIUS_KM,
      clock: "auto",
      timeZoneMode: "auto",
      followLocation: true,
      widgetBackground: "solid",
      forecastSource: DEFAULT_FORECAST_SOURCE,
      dailyLayout: defaultDailyLayout(),
      googleKey: "",
      language: "auto",
      professional: false,
      composerOpen: false,
      paletteOpen: false,
      archiveAt: null,
      setArchiveAt: (archiveAt) => set({ archiveAt }),
      setMode: (mode) => {
        const cur = get().mode;
        if (cur !== mode) set({ mode, previousMode: cur });
      },
      setLocation: (location) => set({ location }),
      setUnits: (u) =>
        set((s) => ({ units: typeof u === "string" ? { ...UNIT_PRESETS[u] } : { ...s.units, ...u } })),
      setTheme: (theme) => set({ theme }),
      setRadar: (r) => set((s) => ({ radar: { ...s.radar, ...r } })),
      setDrone: (d) => set((s) => ({ drone: { ...s.drone, ...d } })),
      setAirLayer: (airLayer) => set({ airLayer }),
      setRadiusKm: (radiusKm) => set({ radiusKm: Math.min(MAX_RADIUS_KM, Math.max(10, radiusKm)) }),
      setClock: (clock) => {
        setTimePrefs({ clock });
        set({ clock });
      },
      setTimeZoneMode: (timeZoneMode) => {
        setTimePrefs({ zone: timeZoneMode });
        set({ timeZoneMode });
      },
      setFollowLocation: (followLocation) => set({ followLocation }),
      setWidgetBackground: (widgetBackground) => set({ widgetBackground }),
      setForecastSource: (forecastSource) => set({ forecastSource }),
      setDailyLayout: (layout) => set({ dailyLayout: normalizeDailyLayout(layout) }),
      setGoogleKey: (googleKey) => set({ googleKey: googleKey.trim().slice(0, 200) }),
      setLanguage: (language) => set({ language }),
      // Turning it off while in the Pro workspace goes back to the radar.
      setProfessional: (professional) => set((s) => (!professional && s.mode === "professional" ? { professional, mode: "severe", previousMode: s.mode } : { professional })),
      setComposerOpen: (composerOpen) => set({ composerOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "stormcentral:v1",
      version: 1,
      // Rehydrated from a client effect so SSR markup and first client render match.
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ mode: s.mode, location: s.location, units: s.units, theme: s.theme, radar: s.radar, drone: s.drone, airLayer: s.airLayer, radiusKm: s.radiusKm, clock: s.clock, timeZoneMode: s.timeZoneMode, followLocation: s.followLocation, widgetBackground: s.widgetBackground, forecastSource: s.forecastSource, dailyLayout: s.dailyLayout, googleKey: s.googleKey, language: s.language, professional: s.professional }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          mode: isModeId(p.mode) ? p.mode : current.mode,
          radar: normalizeRadar({ ...current.radar, ...p.radar }),
          drone: { ...current.drone, ...p.drone },
          units: { ...current.units, ...p.units },
          radiusKm: typeof p.radiusKm === "number" && p.radiusKm > 0 ? Math.min(MAX_RADIUS_KM, p.radiusKm) : current.radiusKm,
          theme: p.theme === "light" || p.theme === "dark" || p.theme === "system" ? p.theme : current.theme,
          clock: isValidClock(p.clock) ? p.clock : current.clock,
          timeZoneMode: isValidZone(p.timeZoneMode) ? p.timeZoneMode : current.timeZoneMode,
          followLocation: typeof p.followLocation === "boolean" ? p.followLocation : current.followLocation,
          widgetBackground: p.widgetBackground === "transparent" ? "transparent" : "solid",
          forecastSource: isForecastSourceId(p.forecastSource) ? p.forecastSource : current.forecastSource,
          dailyLayout: normalizeDailyLayout(p.dailyLayout),
          googleKey: typeof p.googleKey === "string" ? p.googleKey.slice(0, 200) : "",
          language: isLangPref(p.language) ? p.language : current.language,
          professional: p.professional === true,
          // The Pro workspace only exists while Professional mode is on.
          ...(isModeId(p.mode) && p.mode === "professional" && p.professional !== true ? { mode: "severe" as const } : {}),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Before anything renders with the restored settings.
        setTimePrefs({ clock: state.clock, zone: state.timeZoneMode });
        // First visit: pick units from the browser locale.
        if (!localStorage.getItem("stormcentral:v1")) {
          let zone: string | undefined;
          try {
            zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch {
            /* no Intl time zone support */
          }
          state.setUnits(defaultUnitsForLocale(navigator.languages?.length ? navigator.languages : [navigator.language], zone));
        }
        useAppStore.setState({ hydrated: true });
      },
    },
  ),
);
