"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AlertRule, AlertSettings, SavedPlace } from "@/lib/alerting/types";

/**
 * Saved places, notification settings and custom alerts. Kept apart from the
 * main app store so its persisted shape can evolve on its own. Everything is
 * local to the device; on Android it is mirrored to the background runner.
 */
export interface AlertsState {
  /** False until persisted state is restored (rehydrated from Providers). */
  hydrated: boolean;
  places: SavedPlace[];
  settings: AlertSettings;
  rules: AlertRule[];
  addPlace: (p: Omit<SavedPlace, "id">) => SavedPlace | null;
  removePlace: (id: string) => void;
  setSettings: (s: Partial<AlertSettings>) => void;
  addRule: (r: Omit<AlertRule, "id">) => void;
  updateRule: (id: string, r: Partial<AlertRule>) => void;
  removeRule: (id: string) => void;
}

export const MAX_PLACES = 10;
export const MAX_RULES = 20;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = { enabled: false, level: "warnings", watchCurrent: true };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

const samePlace = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      places: [],
      settings: DEFAULT_ALERT_SETTINGS,
      rules: [],
      addPlace: (p) => {
        const { places } = get();
        const existing = places.find((q) => samePlace(q, p));
        if (existing) return existing;
        if (places.length >= MAX_PLACES) return null;
        const place: SavedPlace = { id: newId(), name: p.name.slice(0, 80), lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4 };
        set({ places: [...places, place] });
        return place;
      },
      // Rules for a removed place go with it.
      removePlace: (id) => set((s) => ({ places: s.places.filter((p) => p.id !== id), rules: s.rules.filter((r) => r.placeId !== id) })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      addRule: (r) => set((s) => (s.rules.length >= MAX_RULES ? s : { rules: [...s.rules, { ...r, id: newId() }] })),
      updateRule: (id, patch) => set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch, id } : r)) })),
      removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
    }),
    {
      name: "stormcentral:alerts:v1",
      version: 1,
      // Rehydrated from a client effect (Providers) so SSR markup and first render match.
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ places: s.places, settings: s.settings, rules: s.rules }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AlertsState>;
        return {
          ...current,
          places: Array.isArray(p.places) ? p.places : current.places,
          rules: Array.isArray(p.rules) ? p.rules : current.rules,
          settings: { ...current.settings, ...p.settings },
        };
      },
      onRehydrateStorage: () => () => useAlertsStore.setState({ hydrated: true }),
    },
  ),
);
