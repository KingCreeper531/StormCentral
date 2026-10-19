/**
 * Professional-mode workspace settings (saved on this device): the panel
 * layout, what each pane shows, the loop, and the analysis tool in use.
 * The fast-changing shared view (camera, loop index, cursor) lives on the
 * sync bus instead (lib/pro/sync.ts) so it never re-renders React.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isProProductId, type ProProductId } from "@/lib/pro/products";
import { TILTS, type TiltPrefix } from "@/lib/radar/products";
import type { LatLon } from "@/lib/geo";
import type { Ring } from "@/lib/warngen/geometry";
import { WARN_PRODUCTS, type WarnBasis, type WarnKind, type WarnThreat } from "@/lib/warngen/products";

export const LAYOUTS = ["1x1", "1x2", "2x2", "3x3"] as const;
export type Layout = (typeof LAYOUTS)[number];
export const PANE_COUNT: Record<Layout, number> = { "1x1": 1, "1x2": 2, "2x2": 4, "3x3": 9 };

export interface PaneConfig {
  id: string;
  product: ProProductId;
  /** NEXRAD site (ICAO) for single-site products; null follows the workspace site. */
  site: string | null;
  tilt: TiltPrefix;
  /** Level II products: the elevation angle (degrees) to show. */
  elev: number;
  opacity: number;
  warnings: boolean;
  cells: boolean;
}

export type ProTool = "inspect" | "sounding" | "xsect" | "vector" | "toa" | "warngen";

/**
 * The WarnGen editor's draft (this session only). The storm is the storm
 * vector's picks; the polygon is drawn from its track until a corner is
 * dragged, after which `polygon` holds the edited shape.
 */
export interface WarnDraft {
  kind: WarnKind;
  minutes: number;
  basis: WarnBasis;
  hail: number;
  wind: number;
  tornadoPossible: boolean;
  threat: WarnThreat;
  notes: string;
  /** Hand-edited polygon; null = drawn from the storm's track. */
  polygon: Ring | null;
  /** Typed-in motion (toward, knots) replacing the picked track; null = from the picks. */
  motion: { headingDeg: number; speedKt: number } | null;
  /** Updating this issued warning (its id) instead of issuing a new one. */
  editing: string | null;
}

export const newDraft = (kind: WarnKind = "SVR"): WarnDraft => ({
  kind,
  minutes: WARN_PRODUCTS[kind].defaultMinutes,
  basis: "radar",
  hail: kind === "SVR" ? 1 : 0,
  wind: kind === "SVR" ? 60 : 0,
  tornadoPossible: false,
  threat: "base",
  notes: "",
  polygon: null,
  motion: null,
  editing: null,
});

/** Two clicks on storm centroids at two loop times. */
export interface StormVector {
  a: LatLon & { t: number };
  b: (LatLon & { t: number }) | null;
}

export interface ProState {
  layout: Layout;
  panes: PaneConfig[];
  /** The workspace radar site (ICAO) single-site panes use unless they pick their own; null = nearest to your location. */
  site: string | null;
  frames: number;
  /** Loop speed multiplier (1 = the radar mode's normal pace). */
  speed: 0.5 | 1 | 2;
  tool: ProTool;
  vector: StormVector | null;
  /** Points of interest for the time-of-arrival fan (besides your location and saved places). */
  toaPoints: (LatLon & { name: string })[];
  warnDraft: WarnDraft;
  setLayout: (l: Layout) => void;
  setPane: (id: string, patch: Partial<Omit<PaneConfig, "id">>) => void;
  setSite: (icao: string | null) => void;
  setFrames: (n: number) => void;
  setSpeed: (s: ProState["speed"]) => void;
  setTool: (t: ProTool) => void;
  setVector: (v: StormVector | null) => void;
  addToaPoint: (p: LatLon & { name: string }) => void;
  clearToaPoints: () => void;
  setWarnDraft: (patch: Partial<WarnDraft> | ((d: WarnDraft) => Partial<WarnDraft>)) => void;
  resetWarnDraft: (kind?: WarnKind) => void;
}

/** 2×2 opens on products every site has (super-res REF/VEL from NOAA, SRV, MRMS); dual-pol fills out the 3×3. */
const DEFAULT_PRODUCTS: ProProductId[] = ["ref", "vel", "srv", "cref", "cc", "zdr", "hc", "sat-ir", "eet"];

export function defaultPanes(): PaneConfig[] {
  return DEFAULT_PRODUCTS.map((product, i) => ({ id: `p${i + 1}`, product, site: null, tilt: "N0", elev: 0.5, opacity: 0.85, warnings: true, cells: false }));
}

const TILT_SET = new Set<string>(TILTS.map((t) => t.prefix));

function normalizePanes(raw: unknown): PaneConfig[] {
  const base = defaultPanes();
  if (!Array.isArray(raw)) return base;
  return base.map((d, i) => {
    const p = raw[i] as Partial<PaneConfig> | undefined;
    if (!p || typeof p !== "object") return d;
    return {
      id: d.id,
      product: isProProductId(p.product) ? p.product : d.product,
      site: typeof p.site === "string" && /^[A-Z]{4}$/.test(p.site) ? p.site : null,
      tilt: typeof p.tilt === "string" && TILT_SET.has(p.tilt) ? (p.tilt as TiltPrefix) : d.tilt,
      elev: typeof p.elev === "number" && p.elev >= 0 && p.elev <= 20 ? p.elev : d.elev,
      opacity: typeof p.opacity === "number" ? Math.min(1, Math.max(0.1, p.opacity)) : d.opacity,
      warnings: typeof p.warnings === "boolean" ? p.warnings : d.warnings,
      cells: typeof p.cells === "boolean" ? p.cells : d.cells,
    };
  });
}

export const useProStore = create<ProState>()(
  persist(
    (set) => ({
      layout: "2x2",
      panes: defaultPanes(),
      site: null,
      frames: 10,
      speed: 1,
      tool: "inspect",
      vector: null,
      toaPoints: [],
      warnDraft: newDraft(),
      setLayout: (layout) => set({ layout }),
      setPane: (id, patch) => set((s) => ({ panes: s.panes.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      setSite: (site) => set({ site }),
      setFrames: (frames) => set({ frames: Math.min(20, Math.max(4, Math.round(frames))) }),
      setSpeed: (speed) => set({ speed }),
      setTool: (tool) => set({ tool }),
      setVector: (vector) => set({ vector }),
      addToaPoint: (p) => set((s) => ({ toaPoints: [...s.toaPoints, p].slice(-8) })),
      clearToaPoints: () => set({ toaPoints: [] }),
      setWarnDraft: (patch) => set((s) => ({ warnDraft: { ...s.warnDraft, ...(typeof patch === "function" ? patch(s.warnDraft) : patch) } })),
      resetWarnDraft: (kind) => set((s) => ({ warnDraft: newDraft(kind ?? s.warnDraft.kind) })),
    }),
    {
      name: "stormcentral:pro",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ layout: s.layout, panes: s.panes, site: s.site, frames: s.frames, speed: s.speed }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ProState>;
        return {
          ...current,
          layout: (LAYOUTS as readonly string[]).includes(p.layout as string) ? (p.layout as Layout) : current.layout,
          panes: normalizePanes(p.panes),
          site: typeof p.site === "string" && /^[A-Z]{4}$/.test(p.site) ? p.site : null,
          frames: typeof p.frames === "number" ? Math.min(20, Math.max(4, Math.round(p.frames))) : current.frames,
          speed: p.speed === 0.5 || p.speed === 2 ? p.speed : 1,
        };
      },
    },
  ),
);
