"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { OutlookKind } from "@/lib/api/types";
import type { LatLon } from "@/lib/geo";
import type { ProductFamily, TiltPrefix } from "@/lib/radar/products";
import type { Speed } from "@/lib/radar/playback";
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
  /** Active tropical cyclones: NHC cone, track and forecast points. */
  showTropical: boolean;
  showSites: boolean;
  showTracks: boolean;
  /** HRRR model forecast frames after the live loop (national mosaic). */
  future: boolean;
  /** NOAA lightning strike density. */
  showLightning: boolean;
}

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
  setComposerOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
}

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
  showTropical: true,
  showSites: true,
  showTracks: true,
  future: true,
  showLightning: true,
};

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
      composerOpen: false,
      paletteOpen: false,
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
      setComposerOpen: (composerOpen) => set({ composerOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "stormcentral:v1",
      version: 1,
      // Rehydrated from a client effect so SSR markup and first client render match.
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ mode: s.mode, location: s.location, units: s.units, theme: s.theme, radar: s.radar, drone: s.drone, airLayer: s.airLayer, radiusKm: s.radiusKm }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          mode: isModeId(p.mode) ? p.mode : current.mode,
          radar: { ...current.radar, ...p.radar },
          drone: { ...current.drone, ...p.drone },
          units: { ...current.units, ...p.units },
          radiusKm: typeof p.radiusKm === "number" && p.radiusKm > 0 ? Math.min(MAX_RADIUS_KM, p.radiusKm) : current.radiusKm,
          theme: p.theme === "light" || p.theme === "dark" || p.theme === "system" ? p.theme : current.theme,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
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
