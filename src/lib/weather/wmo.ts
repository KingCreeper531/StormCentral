/**
 * WMO 4677 weather interpretation codes (the subset Open-Meteo emits) mapped
 * to human labels, Makin-Things icon names, and a background "scene" that
 * drives the animated sky.
 */

export type Scene =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing"
  | "snow"
  | "storm"
  | "hail";

interface CodeInfo {
  label: string;
  /** Icon base name. `~` is replaced by `day`/`night`. */
  icon: string;
  scene: Scene;
  /** 0..1 — scales particle density for the background. */
  intensity: number;
}

const CODES: Record<number, CodeInfo> = {
  0: { label: "Clear", icon: "clear-~", scene: "clear", intensity: 0 },
  1: { label: "Mostly clear", icon: "cloudy-1-~", scene: "partly", intensity: 0 },
  2: { label: "Partly cloudy", icon: "cloudy-2-~", scene: "partly", intensity: 0 },
  3: { label: "Overcast", icon: "cloudy", scene: "cloudy", intensity: 0 },
  45: { label: "Fog", icon: "fog-~", scene: "fog", intensity: 0 },
  48: { label: "Freezing fog", icon: "frost-~", scene: "fog", intensity: 0 },
  51: { label: "Light drizzle", icon: "rainy-1-~", scene: "drizzle", intensity: 0.15 },
  53: { label: "Drizzle", icon: "rainy-1", scene: "drizzle", intensity: 0.25 },
  55: { label: "Heavy drizzle", icon: "rainy-2", scene: "drizzle", intensity: 0.35 },
  56: { label: "Freezing drizzle", icon: "rain-and-sleet-mix", scene: "freezing", intensity: 0.25 },
  57: { label: "Heavy freezing drizzle", icon: "rain-and-sleet-mix", scene: "freezing", intensity: 0.4 },
  61: { label: "Light rain", icon: "rainy-2-~", scene: "rain", intensity: 0.35 },
  63: { label: "Rain", icon: "rainy-2", scene: "rain", intensity: 0.6 },
  65: { label: "Heavy rain", icon: "rainy-3", scene: "rain", intensity: 0.9 },
  66: { label: "Freezing rain", icon: "rain-and-sleet-mix", scene: "freezing", intensity: 0.45 },
  67: { label: "Heavy freezing rain", icon: "rain-and-sleet-mix", scene: "freezing", intensity: 0.75 },
  71: { label: "Light snow", icon: "snowy-1-~", scene: "snow", intensity: 0.3 },
  73: { label: "Snow", icon: "snowy-2", scene: "snow", intensity: 0.6 },
  75: { label: "Heavy snow", icon: "snowy-3", scene: "snow", intensity: 0.95 },
  77: { label: "Snow grains", icon: "snow-and-sleet-mix", scene: "snow", intensity: 0.3 },
  80: { label: "Light showers", icon: "rainy-1-~", scene: "rain", intensity: 0.4 },
  81: { label: "Showers", icon: "rainy-2-~", scene: "rain", intensity: 0.65 },
  82: { label: "Violent showers", icon: "rainy-3", scene: "rain", intensity: 1 },
  85: { label: "Snow showers", icon: "snowy-1-~", scene: "snow", intensity: 0.45 },
  86: { label: "Heavy snow showers", icon: "snowy-3", scene: "snow", intensity: 0.9 },
  95: { label: "Thunderstorm", icon: "scattered-thunderstorms-~", scene: "storm", intensity: 0.8 },
  96: { label: "Thunderstorm, hail", icon: "severe-thunderstorm", scene: "hail", intensity: 0.9 },
  99: { label: "Severe thunderstorm, hail", icon: "hail", scene: "hail", intensity: 1 },
};

const UNKNOWN: CodeInfo = { label: "—", icon: "cloudy", scene: "cloudy", intensity: 0 };

export function describeCode(code: number | null | undefined): CodeInfo {
  return (code != null && CODES[code]) || UNKNOWN;
}

export function iconName(code: number | null | undefined, isDay: boolean, opts?: { gustMs?: number }): string {
  const info = describeCode(code);
  // Strong gusts under a benign sky deserve the wind glyph.
  if (opts?.gustMs != null && opts.gustMs >= 17 && (code ?? 0) <= 3) return "wind";
  return info.icon.replace("~", isDay ? "day" : "night");
}

export function iconUrl(name: string, animated = true) {
  return `/icons/weather/${animated ? "animated" : "static"}/${name}.svg`;
}

export function isPrecipCode(code: number | null | undefined) {
  return code != null && code >= 51;
}
