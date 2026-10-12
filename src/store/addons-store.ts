"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { parseAddon, type Addon, type PluginAddon, type ThemeAddon } from "@/lib/addons/manifest";

export interface InstalledPlugin extends PluginAddon {
  enabled: boolean;
  /** Multiplies each layer's own opacity. */
  opacity: number;
}

/**
 * Themes and plugins installed from GitHub. Local to the device, like the
 * rest of the settings. The theme boot script reads this key directly
 * (`stormcentral:addons:v1`), so keep `themes` and `activeTheme` at the top.
 */
export interface AddonsState {
  hydrated: boolean;
  themes: ThemeAddon[];
  activeTheme: string | null;
  plugins: InstalledPlugin[];
  /** Add or update (same source URL) an add-on. A new theme is switched on. */
  install: (a: Addon) => void;
  remove: (id: string) => void;
  setActiveTheme: (id: string | null) => void;
  setPlugin: (id: string, patch: Partial<Pick<InstalledPlugin, "enabled" | "opacity">>) => void;
}

export const MAX_ADDONS = 20;
export const ADDONS_STORAGE_KEY = "stormcentral:addons:v1";

/** Re-validate stored add-ons: storage may hold an older or hand-edited shape. */
function revalidate<T extends Addon>(list: unknown, type: T["type"]): T[] {
  if (!Array.isArray(list)) return [];
  const out: T[] = [];
  for (const raw of list.slice(0, MAX_ADDONS)) {
    try {
      const r = raw as Addon & Record<string, unknown>;
      // Stored add-ons are already in parsed form; map them back to manifest shape.
      const manifest = r.type === "plugin" ? { ...r, layers: r.layers.map((l) => ({ ...l, type: l.kind })) } : r;
      const a = parseAddon(manifest, { id: String(r.id), homepage: typeof r.homepage === "string" ? r.homepage : null });
      if (a.type === type) out.push({ ...(raw as object), ...a } as T);
    } catch {
      /* dropped */
    }
  }
  return out;
}

export const useAddonsStore = create<AddonsState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      themes: [],
      activeTheme: null,
      plugins: [],
      install: (a) => {
        if (a.type === "theme") {
          const rest = get().themes.filter((t) => t.id !== a.id);
          set({ themes: [...rest, a].slice(-MAX_ADDONS), activeTheme: a.id });
        } else {
          const prev = get().plugins.find((p) => p.id === a.id);
          const rest = get().plugins.filter((p) => p.id !== a.id);
          set({ plugins: [...rest, { ...a, enabled: prev?.enabled ?? true, opacity: prev?.opacity ?? 1 }].slice(-MAX_ADDONS) });
        }
      },
      remove: (id) =>
        set((s) => ({
          themes: s.themes.filter((t) => t.id !== id),
          plugins: s.plugins.filter((p) => p.id !== id),
          activeTheme: s.activeTheme === id ? null : s.activeTheme,
        })),
      setActiveTheme: (id) => set((s) => ({ activeTheme: id && s.themes.some((t) => t.id === id) ? id : null })),
      setPlugin: (id, patch) => set((s) => ({ plugins: s.plugins.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    }),
    {
      name: ADDONS_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ themes: s.themes, activeTheme: s.activeTheme, plugins: s.plugins }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AddonsState>;
        const themes = revalidate<ThemeAddon>(p.themes, "theme");
        const plugins = revalidate<PluginAddon>(p.plugins, "plugin").map((pl) => {
          const stored = pl as Partial<InstalledPlugin>;
          return { ...pl, enabled: stored.enabled !== false, opacity: typeof stored.opacity === "number" ? Math.min(1, Math.max(0.1, stored.opacity)) : 1 };
        });
        const activeTheme = typeof p.activeTheme === "string" && themes.some((t) => t.id === p.activeTheme) ? p.activeTheme : null;
        return { ...current, themes, plugins, activeTheme };
      },
      onRehydrateStorage: () => () => useAddonsStore.setState({ hydrated: true }),
    },
  ),
);

/** The custom theme in use, if any. */
export const selectActiveTheme = (s: AddonsState): ThemeAddon | null => (s.activeTheme ? (s.themes.find((t) => t.id === s.activeTheme) ?? null) : null);
