"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { cleanName, cleanPresets, decodeStyle, LIMITS, type MapPreset } from "@/lib/map/presets";
import { DEFAULT_MAP_STYLE, normalizeMapStyle, type MapStyle } from "@/lib/map/style";

/**
 * The map's look (lib/map/style.ts): basemap, terrain, borders, roads,
 * labels and colours, and the person's saved presets (lib/map/presets.ts).
 * One style for every map in the app, kept on this device.
 */
interface MapStyleState {
  style: MapStyle;
  presets: MapPreset[];
  setStyle: (patch: Partial<MapStyle>) => void;
  reset: () => void;
  /** Use a style as it is (a preset, a shared code). */
  apply: (style: MapStyle) => void;
  /** Save the current style under a name (replacing a saved one with the same name). False when the list is full or the name is empty. */
  savePreset: (name: string) => boolean;
  deletePreset: (id: string) => void;
  /**
   * A share code or link: applied, and saved as a preset unless an identical
   * one is or the list is full. Null when the code isn't one.
   */
  importCode: (code: string) => { preset: MapPreset; saved: boolean } | null;
}

const newId = () => `mp-${Math.random().toString(36).slice(2, 10)}`;
const same = (a: MapStyle, b: MapStyle) => JSON.stringify(a) === JSON.stringify(b);

export const useMapStyleStore = create<MapStyleState>()(
  persist(
    (set, get) => ({
      style: DEFAULT_MAP_STYLE,
      presets: [],
      setStyle: (patch) => set((s) => ({ style: normalizeMapStyle({ ...s.style, ...patch }) })),
      reset: () => set({ style: DEFAULT_MAP_STYLE }),
      apply: (style) => set({ style: normalizeMapStyle(style) }),
      savePreset: (raw) => {
        const name = cleanName(raw);
        const { presets, style } = get();
        if (!name) return false;
        const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          set({ presets: presets.map((p) => (p === existing ? { ...p, name, style } : p)) });
          return true;
        }
        if (presets.length >= LIMITS.saved) return false;
        set({ presets: [...presets, { id: newId(), name, style }] });
        return true;
      },
      deletePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
      importCode: (code) => {
        const got = decodeStyle(code);
        if (!got) return null;
        const { presets } = get();
        const known = presets.find((x) => same(x.style, got.style));
        const preset = known ?? { id: newId(), name: got.name, style: got.style };
        const saved = !!known || presets.length < LIMITS.saved;
        set(known || !saved ? { style: got.style } : { style: got.style, presets: [...presets, preset] });
        return { preset, saved };
      },
    }),
    {
      name: "stormcentral:map-style:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ style, presets }) => ({ style, presets }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<MapStyleState>;
        return { ...current, style: normalizeMapStyle(p.style), presets: cleanPresets(p.presets) };
      },
    },
  ),
);
