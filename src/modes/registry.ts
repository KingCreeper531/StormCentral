/**
 * Mode registry — the single source of truth for what each operating mode
 * is, how it looks, and how aggressively it polls. Modes are *projections*
 * over shared, normalised data: switching never refetches what's cached.
 */
export const MODE_IDS = ["daily", "severe", "drone", "angler", "air"] as const;
export type ModeId = (typeof MODE_IDS)[number];

export interface ModeDef {
  id: ModeId;
  label: string;
  tagline: string;
  /** Makin-Things icon used in the switcher. */
  icon: string;
  /** Accent colour used for focus rings, active pills and glows. */
  accent: string;
  hotkey: string;
  /** Map-first modes hide the sky background and go edge-to-edge. */
  immersiveMap: boolean;
}

export const MODES: Record<ModeId, ModeDef> = {
  daily: {
    id: "daily",
    label: "Daily",
    tagline: "Conditions, hourly & 10-day outlook",
    icon: "clear-day",
    accent: "#38bdf8",
    hotkey: "1",
    immersiveMap: false,
  },
  severe: {
    id: "severe",
    label: "Severe",
    tagline: "NEXRAD radar, warnings & storm tracks",
    icon: "severe-thunderstorm",
    accent: "#f43f5e",
    hotkey: "2",
    immersiveMap: true,
  },
  drone: {
    id: "drone",
    label: "UAV Pilot",
    tagline: "Winds aloft, shear, Kp, ceiling & GNSS",
    icon: "wind",
    accent: "#a78bfa",
    hotkey: "3",
    immersiveMap: false,
  },
  angler: {
    id: "angler",
    label: "Angler",
    tagline: "River gauges, pressure trend & solunar",
    icon: "rainy-1-day",
    accent: "#2dd4bf",
    hotkey: "4",
    immersiveMap: false,
  },
  air: {
    id: "air",
    label: "Air & Allergy",
    tagline: "AQI heatmap, PM2.5, ozone & pollen",
    icon: "haze-day",
    accent: "#a3e635",
    hotkey: "5",
    immersiveMap: false,
  },
};

export const isModeId = (v: unknown): v is ModeId => typeof v === "string" && (MODE_IDS as readonly string[]).includes(v);

/**
 * Polling policy per data feed per mode (ms). `false` = don't fetch at all in
 * that mode. Feeds a mode depends on poll hard; everything else idles.
 */
export type Feed = "forecast" | "air" | "localAlerts" | "nationalAlerts" | "radar" | "kp" | "rivers" | "gnss" | "outlook";

const MIN = 60_000;

export const POLLING: Record<Feed, Partial<Record<ModeId, number | false>> & { default: number | false }> = {
  forecast: { default: 10 * MIN, severe: 5 * MIN },
  air: { default: false, daily: 30 * MIN, air: 15 * MIN },
  localAlerts: { default: 5 * MIN, severe: MIN },
  nationalAlerts: { default: false, severe: 45_000 },
  radar: { default: false, daily: 2 * MIN, severe: MIN },
  kp: { default: false, drone: 15 * MIN },
  rivers: { default: false, angler: 10 * MIN },
  gnss: { default: false, drone: 10 * MIN },
  outlook: { default: false, severe: 10 * MIN },
};

export function pollFor(feed: Feed, mode: ModeId): number | false {
  const p = POLLING[feed];
  return p[mode] ?? p.default;
}
