"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { FEATURED_PLUGINS } from "@/lib/addons/featured";
import { parseAddon, type Addon, type PluginAddon, type ThemeAddon } from "@/lib/addons/manifest";

export interface InstalledPlugin extends PluginAddon {
  enabled: boolean;
  /** Multiplies each layer's own opacity. */
  opacity: number;
  /** Layer ids switched off: each plugin's layers can be picked separately. */
  hidden: string[];
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
  setLayerVisible: (id: string, layerId: string, visible: boolean) => void;
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

/** "1.10.0" > "1.9.2"; a missing version is the oldest. */
export function newerVersion(a: string | null, b: string | null): boolean {
  const parts = (v: string | null) => (v ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** A bundled plugin installed from an older version of the app: the bundled manifest replaces it (layers may have moved or changed). */
export function withBundled(p: PluginAddon): PluginAddon {
  const bundled = FEATURED_PLUGINS.find((f) => f.id === p.id);
  return bundled && newerVersion(bundled.version, p.version) ? { ...p, ...bundled } : p;
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
          const ids = new Set(a.layers.map((l) => l.id));
          const hidden = prev ? prev.hidden.filter((h) => ids.has(h)) : a.layers.filter((l) => !l.visible).map((l) => l.id);
          set({ plugins: [...rest, { ...a, enabled: prev?.enabled ?? true, opacity: prev?.opacity ?? 1, hidden }].slice(-MAX_ADDONS) });
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
      setLayerVisible: (id, layerId, visible) =>
        set((s) => ({
          plugins: s.plugins.map((p) =>
            p.id !== id ? p : { ...p, hidden: visible ? p.hidden.filter((h) => h !== layerId) : [...new Set([...p.hidden, layerId])] },
          ),
        })),
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
        const plugins = revalidate<PluginAddon>(p.plugins, "plugin").map((saved) => {
          const stored = saved as Partial<InstalledPlugin>;
          const pl = withBundled(saved);
          const ids = new Set(pl.layers.map((l) => l.id));
          const hidden = Array.isArray(stored.hidden) ? stored.hidden.filter((h): h is string => typeof h === "string" && ids.has(h)) : [];
          return { ...pl, enabled: stored.enabled !== false, opacity: typeof stored.opacity === "number" ? Math.min(1, Math.max(0.1, stored.opacity)) : 1, hidden };
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
