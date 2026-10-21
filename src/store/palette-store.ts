"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { BUILTIN_PALETTES, cleanPalettes, LIMITS, PALETTE_SCALES, type Palette } from "@/lib/pro/palettes";
import type { DecodedScaleId } from "@/lib/pro/scales";

/**
 * Colour tables for decoded radar (lib/pro/palettes.ts): the one picked for
 * each product, and the GRLevelX palettes people imported. Kept on this
 * device.
 */
interface PaletteState {
  /** Palette id per scale; missing means the standard colours. */
  chosen: Partial<Record<DecodedScaleId, string>>;
  imported: Palette[];
  choose: (scale: DecodedScaleId, id: string | null) => void;
  /** Adds an imported palette and picks it. False when the list is full. */
  add: (palette: Omit<Palette, "id">) => boolean;
  remove: (id: string) => void;
}

const newId = () => `pal-${Math.random().toString(36).slice(2, 10)}`;

export const usePaletteStore = create<PaletteState>()(
  persist(
    (set, get) => ({
      chosen: {},
      imported: [],
      choose: (scale, id) =>
        set((s) => {
          const chosen = { ...s.chosen };
          if (id) chosen[scale] = id;
          else delete chosen[scale];
          return { chosen };
        }),
      add: (palette) => {
        if (get().imported.length >= LIMITS.imported) return false;
        const p = { ...palette, id: newId() };
        set((s) => ({ imported: [...s.imported, p], chosen: { ...s.chosen, [p.scale]: p.id } }));
        return true;
      },
      remove: (id) =>
        set((s) => {
          const chosen = Object.fromEntries(Object.entries(s.chosen).filter(([, v]) => v !== id));
          return { imported: s.imported.filter((p) => p.id !== id), chosen };
        }),
    }),
    {
      name: "stormcentral:palettes:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ chosen, imported }) => ({ chosen, imported }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PaletteState>;
        const imported = cleanPalettes(p.imported);
        const known = new Set([...BUILTIN_PALETTES, ...imported].map((x) => x.id));
        const chosen: Partial<Record<DecodedScaleId, string>> = {};
        for (const scale of PALETTE_SCALES) {
          const id = (p.chosen as Record<string, unknown> | undefined)?.[scale];
          if (typeof id === "string" && known.has(id)) chosen[scale] = id;
        }
        return { ...current, imported, chosen };
      },
    },
  ),
);

// Another window (a popped-out Pro panel, say) picked or imported a colour table: use it here too, so this
// window's next save doesn't put the old ones back. Rehydrating doesn't save.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === usePaletteStore.persist.getOptions().name) void usePaletteStore.persist.rehydrate();
  });
}

/** Every palette for a scale: built-in ones, then imported. */
export function palettesFor(scale: DecodedScaleId, imported: readonly Palette[]): Palette[] {
  return [...BUILTIN_PALETTES, ...imported].filter((p) => p.scale === scale);
}

/** The palette picked for a scale, or null for the standard colours. */
export function usePalette(scale: DecodedScaleId | null | undefined): Palette | null {
  const id = usePaletteStore((s) => (scale ? s.chosen[scale] : undefined));
  const imported = usePaletteStore((s) => s.imported);
  if (!scale || !id) return null;
  return [...BUILTIN_PALETTES, ...imported].find((p) => p.id === id && p.scale === scale) ?? null;
}
