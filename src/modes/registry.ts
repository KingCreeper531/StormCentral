import { CloudSun, Drone, Fish, Leaf, Radar, type LucideIcon } from "lucide-react";

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
  /** Label for the mobile tab bar (fits 5 across at 360 px). */
  short: string;
  tagline: string;
  /** Line icon for navigation (weather illustrations are for data, not chrome). */
  Icon: LucideIcon;
  hotkey: string;
  /** Map-first modes hide the sky background and go edge-to-edge. */
  immersiveMap: boolean;
}

export const MODES: Record<ModeId, ModeDef> = {
  daily: { id: "daily", label: "Daily", short: "Daily", tagline: "Conditions, hourly and 10-day forecast", Icon: CloudSun, hotkey: "1", immersiveMap: false },
  severe: { id: "severe", label: "Radar", short: "Radar", tagline: "NEXRAD radar, warnings and storm tracks", Icon: Radar, hotkey: "2", immersiveMap: true },
  drone: { id: "drone", label: "UAV pilot", short: "UAV", tagline: "Winds aloft, shear, Kp, ceiling and GNSS", Icon: Drone, hotkey: "3", immersiveMap: false },
  angler: { id: "angler", label: "Angler", short: "Angler", tagline: "River gauges, pressure trend and solunar", Icon: Fish, hotkey: "4", immersiveMap: false },
  air: { id: "air", label: "Air quality", short: "Air", tagline: "AQI map, particulates, ozone and pollen", Icon: Leaf, hotkey: "5", immersiveMap: false },
};

export const isModeId = (v: unknown): v is ModeId => typeof v === "string" && (MODE_IDS as readonly string[]).includes(v);

/**
 * Polling policy per data feed per mode (ms). `false` = don't fetch at all in
 * that mode. Feeds a mode depends on poll hard; everything else idles.
 */
export type Feed =
  | "forecast"
  | "air"
  | "localAlerts"
  | "nationalAlerts"
  | "radar"
  | "kp"
  | "rivers"
  | "gnss"
  | "outlook"
  | "stormReports"
  | "stormCells"
  | "tropical";

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
  outlook: { default: false, daily: 30 * MIN, severe: 10 * MIN },
  stormReports: { default: false, severe: 2 * MIN },
  stormCells: { default: false, severe: 2 * MIN },
  tropical: { default: false, daily: 30 * MIN, severe: 15 * MIN },
};

export function pollFor(feed: Feed, mode: ModeId): number | false {
  const p = POLLING[feed];
  return p[mode] ?? p.default;
}
