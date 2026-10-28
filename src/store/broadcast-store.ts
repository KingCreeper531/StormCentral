"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { cleanLook, DEFAULT_LOOK, type BroadcastLook } from "@/lib/broadcast/look";

/**
 * Broadcast mode's settings (components/broadcast): the station's name, tag
 * line, logo and colour, which graphics show, and the saved scenes a tour
 * steps through. On this device, like the other settings.
 */
export interface BroadcastScene {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zoom: number;
}

export interface BroadcastParts {
  bug: boolean;
  clock: boolean;
  counts: boolean;
  lower: boolean;
  ticker: boolean;
}

export interface BroadcastSettings {
  name: string;
  tagline: string;
  /** A small PNG as a data: URL (shrunk on upload), or null for the app's icon. */
  logo: string | null;
  /** The LIVE badge and the ticker label. */
  accent: string;
  /** Show the LIVE badge (off for recorded clips). */
  live: boolean;
  parts: BroadcastParts;
  scenes: BroadcastScene[];
  /** Seconds on each scene during a tour. */
  tourSeconds: number;
  /** How the lower third and the ticker look. */
  look: BroadcastLook;
  /** Open in Broadcast mode when the app starts (this device only: not synced). */
  boot: boolean;
  /** Professional mode's panels on air instead of the radar map, while Professional mode is on (this device only: not synced). */
  proView: boolean;
}

interface BroadcastState extends BroadcastSettings {
  set: (patch: Partial<Omit<BroadcastSettings, "parts" | "scenes" | "look">>) => void;
  setLook: (patch: Partial<BroadcastLook>) => void;
  resetLook: (keys: readonly (keyof BroadcastLook)[]) => void;
  setPart: (part: keyof BroadcastParts, on: boolean) => void;
  addScene: (scene: Omit<BroadcastScene, "id">) => void;
  removeScene: (id: string) => void;
  moveScene: (id: string, by: -1 | 1) => void;
}

export const MAX_SCENES = 12;
export const TOUR_SECONDS = [8, 15, 30, 60] as const;
/** The largest logo kept (a data: URL's length). */
export const MAX_LOGO_CHARS = 200_000;
export const DEFAULT_ACCENT = "#e5162b";

const DEFAULTS: BroadcastSettings = {
  name: "Storm Central",
  tagline: "Radar · Warnings",
  logo: null,
  accent: DEFAULT_ACCENT,
  live: true,
  parts: { bug: true, clock: true, counts: true, lower: true, ticker: true },
  scenes: [],
  tourSeconds: 15,
  look: DEFAULT_LOOK,
  boot: false,
  proView: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (s: unknown, max: number, fallback: string) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : fallback);
const validScene = (s: unknown): s is BroadcastScene => {
  const x = s as BroadcastScene;
  return !!x && typeof x.id === "string" && typeof x.name === "string" && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180 && x.zoom >= 0 && x.zoom <= 22;
};

export const useBroadcastStore = create<BroadcastState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) =>
        set((s) => ({
          ...patch,
          name: patch.name != null ? patch.name.slice(0, 40) : s.name,
          tagline: patch.tagline != null ? patch.tagline.slice(0, 60) : s.tagline,
          accent: patch.accent != null && HEX.test(patch.accent) ? patch.accent : s.accent,
          logo: patch.logo === undefined ? s.logo : patch.logo && patch.logo.length <= MAX_LOGO_CHARS && patch.logo.startsWith("data:image/png") ? patch.logo : null,
          tourSeconds: patch.tourSeconds != null && (TOUR_SECONDS as readonly number[]).includes(patch.tourSeconds) ? patch.tourSeconds : s.tourSeconds,
        })),
      setLook: (patch) => set((s) => ({ look: cleanLook(patch, s.look) })),
      resetLook: (keys) => set((s) => ({ look: { ...s.look, ...Object.fromEntries(keys.map((k) => [k, DEFAULT_LOOK[k]])) } })),
      setPart: (part, on) => set((s) => ({ parts: { ...s.parts, [part]: on } })),
      addScene: (scene) =>
        set((s) => ({ scenes: [...s.scenes, { ...scene, name: scene.name.slice(0, 40), id: Math.random().toString(36).slice(2, 10) }].slice(-MAX_SCENES) })),
      removeScene: (id) => set((s) => ({ scenes: s.scenes.filter((x) => x.id !== id) })),
      moveScene: (id, by) =>
        set((s) => {
          const i = s.scenes.findIndex((x) => x.id === id);
          const j = i + by;
          if (i < 0 || j < 0 || j >= s.scenes.length) return {};
          const scenes = [...s.scenes];
          [scenes[i], scenes[j]] = [scenes[j]!, scenes[i]!];
          return { scenes };
        }),
    }),
    {
      name: "stormcentral:broadcast:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ name, tagline, logo, accent, live, parts, scenes, tourSeconds, look, boot, proView }) => ({ name, tagline, logo, accent, live, parts, scenes, tourSeconds, look, boot, proView }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BroadcastSettings>;
        const parts = { ...DEFAULTS.parts };
        for (const k of Object.keys(parts) as (keyof BroadcastParts)[]) if (typeof p.parts?.[k] === "boolean") parts[k] = p.parts[k];
        return {
          ...current,
          name: clean(p.name, 40, DEFAULTS.name),
          tagline: clean(p.tagline, 60, DEFAULTS.tagline),
          logo: typeof p.logo === "string" && p.logo.startsWith("data:image/png") && p.logo.length <= MAX_LOGO_CHARS ? p.logo : null,
          accent: typeof p.accent === "string" && HEX.test(p.accent) ? p.accent : DEFAULTS.accent,
          live: p.live !== false,
          parts,
          scenes: (Array.isArray(p.scenes) ? p.scenes.filter(validScene) : []).slice(0, MAX_SCENES),
          tourSeconds: (TOUR_SECONDS as readonly number[]).includes(p.tourSeconds as number) ? (p.tourSeconds as number) : DEFAULTS.tourSeconds,
          look: cleanLook(p.look),
          boot: p.boot === true,
          proView: p.proView === true,
        };
      },
    },
  ),
);

/** Shrink an image file to a PNG at most `size` px on its longer side, as a data: URL. */
export async function logoFromFile(file: File, size = 256): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("not-an-image");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/png");
  if (url.length > MAX_LOGO_CHARS) throw new Error("too-big");
  return url;
}
