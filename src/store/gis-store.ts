"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { GisFormat } from "@/lib/gis";

/**
 * Custom map layers (placefiles, KML, GeoJSON) people add by link or from a
 * file. On this device only, like the other settings. A file's text is kept
 * under its own key, so toggling a layer doesn't rewrite megabytes.
 */
export interface GisLayerConfig {
  id: string;
  name: string;
  /** Re-read on the layer's refresh; null for a file. */
  url: string | null;
  fileName: string | null;
  format: GisFormat;
  enabled: boolean;
  /** Multiplies the layer's own opacities. */
  opacity: number;
}

interface GisState {
  layers: GisLayerConfig[];
  /** Adds a layer and returns its id; a file's text is stored with it. Throws when the device is out of room. */
  add: (layer: Omit<GisLayerConfig, "id" | "enabled" | "opacity">, text?: string) => string;
  remove: (id: string) => void;
  setLayer: (id: string, patch: Partial<Pick<GisLayerConfig, "enabled" | "opacity" | "name">>) => void;
}

export const MAX_GIS_LAYERS = 20;
export const GIS_STORAGE_KEY = "stormcentral:gis:v1";
const fileKey = (id: string) => `stormcentral:gis-file:${id}`;

/** A file layer's text, or null when it's gone (storage cleared). */
export function gisFileText(id: string): string | null {
  try {
    return localStorage.getItem(fileKey(id));
  } catch {
    return null;
  }
}

export const useGisStore = create<GisState>()(
  persist(
    (set, get) => ({
      layers: [],
      add: (layer, text) => {
        if (get().layers.length >= MAX_GIS_LAYERS) throw new Error("too-many");
        const id = Math.random().toString(36).slice(2, 10);
        if (text != null) {
          try {
            localStorage.setItem(fileKey(id), text);
          } catch {
            throw new Error("no-room");
          }
        }
        set((s) => ({ layers: [...s.layers, { ...layer, id, enabled: true, opacity: 1 }] }));
        return id;
      },
      remove: (id) => {
        try {
          localStorage.removeItem(fileKey(id));
        } catch {
          /* already gone */
        }
        set((s) => ({ layers: s.layers.filter((l) => l.id !== id) }));
      },
      setLayer: (id, patch) => set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
    }),
    {
      name: GIS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ layers: s.layers }),
      merge: (persisted, current) => {
        const raw = (persisted as Partial<GisState> | undefined)?.layers;
        const layers = (Array.isArray(raw) ? raw : [])
          .filter((l): l is GisLayerConfig => !!l && typeof l.id === "string" && typeof l.name === "string" && (l.format === "placefile" || l.format === "kml" || l.format === "geojson"))
          .slice(0, MAX_GIS_LAYERS)
          .map((l) => ({
            ...l,
            url: typeof l.url === "string" && /^https?:\/\//i.test(l.url) ? l.url : null,
            fileName: typeof l.fileName === "string" ? l.fileName : null,
            enabled: l.enabled !== false,
            opacity: typeof l.opacity === "number" ? Math.min(1, Math.max(0.1, l.opacity)) : 1,
          }))
          .filter((l) => l.url || l.fileName);
        return { ...current, layers };
      },
    },
  ),
);
