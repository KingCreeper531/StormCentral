import type { TempUnit, WindUnit } from "../weather/units";

/** A place the user wants warnings and custom alerts for. */
export interface SavedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Id of the pseudo-place that follows the app's selected location. */
export const CURRENT_PLACE_ID = "current";

export type RuleMetric = "temp" | "gust" | "precipProb" | "uv" | "uavWind" | "flyability" | "bite" | "aqi";
export type RuleOp = "above" | "below";

/** "Notify me when <metric> is <op> <value> within the next <hours> h at <place>." */
export interface AlertRule {
  id: string;
  /** A saved place id, or CURRENT_PLACE_ID. */
  placeId: string;
  metric: RuleMetric;
  op: RuleOp;
  /** Threshold in canonical units: °C, m/s, %, index points, US AQI. */
  value: number;
  /** Look-ahead window in hours. */
  hours: number;
  enabled: boolean;
}

/** "warnings": warnings and emergencies only. "all": watches and advisories too. */
export type WarningLevel = "warnings" | "all";

/** Warning types the user can mute one by one. */
export type AlertCategory = "tornado" | "severe" | "flood" | "tropical" | "winter" | "heat" | "wind" | "fire" | "other";

export const ALERT_CATEGORIES: readonly { id: AlertCategory; label: string }[] = [
  { id: "tornado", label: "Tornado" },
  { id: "severe", label: "Severe thunderstorm" },
  { id: "flood", label: "Flood and flash flood" },
  { id: "tropical", label: "Hurricane and tropical storm" },
  { id: "winter", label: "Winter storm, ice and cold" },
  { id: "heat", label: "Heat" },
  { id: "wind", label: "High wind" },
  { id: "fire", label: "Fire weather" },
  { id: "other", label: "Everything else (fog, air quality, marine…)" },
];

export interface AlertSettings {
  /** Master switch for notifications. */
  enabled: boolean;
  level: WarningLevel;
  /** Also watch the app's selected location. */
  watchCurrent: boolean;
  /** Muted warning types are `false`; missing means on (older saved settings). */
  categories?: Partial<Record<AlertCategory, boolean>>;
  /** Custom alerts (forecast thresholds); missing means on. */
  custom?: boolean;
}

/**
 * Everything the alert engine needs, as plain JSON. The page builds it from
 * the stores; on Android it is also handed to the background runner.
 */
export interface WatchConfig {
  settings: AlertSettings;
  /** Places to check, the current location already resolved (id CURRENT_PLACE_ID). */
  places: SavedPlace[];
  rules: AlertRule[];
  units: { temp: TempUnit; wind: WindUnit };
  drone: { altitudeM: number; profileId: string };
}

/** A notification the engine wants shown. `id` is a stable 31-bit integer. */
export interface AppNotification {
  id: number;
  title: string;
  body: string;
  kind: "warning" | "custom" | "test";
}
