"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { OutlookKind } from "@/lib/api/types";
import type { LatLon } from "@/lib/geo";
import type { ProductFamily, TiltPrefix } from "@/lib/radar/products";
import type { Speed } from "@/lib/radar/playback";
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
  radar: RadarSettings;
  drone: DroneSettings;
  airLayer: "us_aqi" | "pm2_5";
  composerOpen: boolean;
  paletteOpen: boolean;
  setMode: (mode: ModeId) => void;
  setLocation: (loc: AppLocation) => void;
  setUnits: (u: Partial<UnitPrefs> | "imperial" | "metric") => void;
  setRadar: (r: Partial<RadarSettings>) => void;
  setDrone: (d: Partial<DroneSettings>) => void;
  setAirLayer: (l: AppState["airLayer"]) => void;
  setComposerOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
}

/** Norman, OK — home of the Storm Prediction Center. */
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
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      mode: "daily",
      previousMode: null,
      location: DEFAULT_LOCATION,
      units: { ...UNIT_PRESETS.imperial },
      radar: DEFAULT_RADAR,
      drone: { profileId: "sub250", altitudeM: 120 },
      airLayer: "us_aqi",
      composerOpen: false,
      paletteOpen: false,
      setMode: (mode) => {
        const cur = get().mode;
        if (cur !== mode) set({ mode, previousMode: cur });
      },
      setLocation: (location) => set({ location }),
      setUnits: (u) =>
        set((s) => ({ units: typeof u === "string" ? { ...UNIT_PRESETS[u] } : { ...s.units, ...u } })),
      setRadar: (r) => set((s) => ({ radar: { ...s.radar, ...r } })),
      setDrone: (d) => set((s) => ({ drone: { ...s.drone, ...d } })),
      setAirLayer: (airLayer) => set({ airLayer }),
      setComposerOpen: (composerOpen) => set({ composerOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "stormcentral:v1",
      version: 1,
      // Rehydrated from a client effect so SSR markup and first client render match.
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ mode: s.mode, location: s.location, units: s.units, radar: s.radar, drone: s.drone, airLayer: s.airLayer }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          mode: isModeId(p.mode) ? p.mode : current.mode,
          radar: { ...current.radar, ...p.radar },
          drone: { ...current.drone, ...p.drone },
          units: { ...current.units, ...p.units },
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // First visit: pick units from the browser locale.
        if (!localStorage.getItem("stormcentral:v1")) state.setUnits(defaultUnitsForLocale(navigator.language));
        useAppStore.setState({ hydrated: true });
      },
    },
  ),
);
