"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_MAP_STYLE, normalizeMapStyle, type MapStyle } from "@/lib/map/style";

/**
 * The map's look (lib/map/style.ts): basemap, terrain, borders, roads,
 * labels and colours. One style for every map in the app, kept on this
 * device.
 */
interface MapStyleState {
  style: MapStyle;
  setStyle: (patch: Partial<MapStyle>) => void;
  reset: () => void;
}

export const useMapStyleStore = create<MapStyleState>()(
  persist(
    (set) => ({
      style: DEFAULT_MAP_STYLE,
      setStyle: (patch) => set((s) => ({ style: normalizeMapStyle({ ...s.style, ...patch }) })),
      reset: () => set({ style: DEFAULT_MAP_STYLE }),
    }),
    {
      name: "stormcentral:map-style:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ style }) => ({ style }),
      merge: (persisted, current) => ({ ...current, style: normalizeMapStyle((persisted as Partial<MapStyleState> | undefined)?.style) }),
    },
  ),
);
