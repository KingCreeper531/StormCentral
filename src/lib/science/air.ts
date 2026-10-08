/**
 * Air-quality and pollen categorisation.
 *  - US AQI: EPA Technical Assistance Document (2024 PM2.5 revision colours).
 *  - Pollen: US National Allergy Bureau (NAB) grains/m³ scales.
 */

export interface AqiCategory {
  level: 0 | 1 | 2 | 3 | 4 | 5;
  label: string;
  short: string;
  /** Official EPA swatch — used for map/heat fills, never for text. */
  color: string;
  advice: string;
}

export const US_AQI_CATEGORIES: readonly (AqiCategory & { max: number })[] = [
  { level: 0, max: 50, label: "Good", short: "Good", color: "#00e400", advice: "Air quality is satisfactory. Great day to be outside." },
  { level: 1, max: 100, label: "Moderate", short: "Moderate", color: "#ffff00", advice: "Unusually sensitive people should consider reducing prolonged or heavy exertion." },
  { level: 2, max: 150, label: "Unhealthy for Sensitive Groups", short: "USG", color: "#ff7e00", advice: "Sensitive groups (asthma, heart disease, children, older adults) should limit prolonged exertion." },
  { level: 3, max: 200, label: "Unhealthy", short: "Unhealthy", color: "#ff0000", advice: "Everyone should reduce prolonged or heavy exertion; sensitive groups should avoid it." },
  { level: 4, max: 300, label: "Very Unhealthy", short: "Very Unhealthy", color: "#8f3f97", advice: "Health alert: everyone should avoid prolonged exertion outdoors." },
  { level: 5, max: Number.POSITIVE_INFINITY, label: "Hazardous", short: "Hazardous", color: "#7e0023", advice: "Emergency conditions. Remain indoors with filtered air." },
];

export function usAqiCategory(aqi: number | null | undefined): AqiCategory | null {
  if (aqi == null || !Number.isFinite(aqi)) return null;
  return US_AQI_CATEGORIES.find((c) => aqi <= c.max) ?? US_AQI_CATEGORIES[5]!;
}

/** Piecewise-linear colour for continuous AQI (heatmap rendering). */
export function aqiColorRgb(aqi: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [0, 228, 0]],
    [50, [0, 228, 0]],
    [75, [255, 255, 0]],
    [100, [255, 255, 0]],
    [125, [255, 126, 0]],
    [150, [255, 126, 0]],
    [175, [255, 0, 0]],
    [200, [255, 0, 0]],
    [250, [143, 63, 151]],
    [300, [143, 63, 151]],
    [400, [126, 0, 35]],
  ];
  if (aqi <= 0) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i]!;
    const [v0, c0] = stops[i - 1]!;
    if (aqi <= v1) {
      const t = (aqi - v0) / (v1 - v0 || 1);
      return [0, 1, 2].map((k) => Math.round(c0[k]! + (c1[k]! - c0[k]!) * t)) as [number, number, number];
    }
  }
  return stops[stops.length - 1]![1];
}

/** PM2.5 µg/m³ → colour on the same EPA scale (2024 breakpoints). */
export function pm25ToAqi(pm: number) {
  const bp: [number, number, number, number][] = [
    [0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500],
  ];
  const c = Math.floor(pm * 10) / 10;
  for (const [cl, ch, il, ih] of bp) if (c <= ch) return Math.round(((ih - il) / (ch - cl)) * (Math.max(c, cl) - cl) + il);
  return 500;
}

export type PollenType = "alder" | "birch" | "olive" | "grass" | "mugwort" | "ragweed";
export type PollenGroup = "tree" | "grass" | "weed";

export const POLLEN_GROUP: Record<PollenType, PollenGroup> = {
  alder: "tree",
  birch: "tree",
  olive: "tree",
  grass: "grass",
  mugwort: "weed",
  ragweed: "weed",
};

/** NAB thresholds: [moderate, high, very high] lower bounds, grains/m³. */
const NAB: Record<PollenGroup, [number, number, number]> = {
  tree: [15, 90, 1500],
  grass: [5, 20, 200],
  weed: [10, 50, 500],
};

export type PollenLevel = "none" | "low" | "moderate" | "high" | "very high";

export function pollenLevel(type: PollenType, grains: number | null | undefined): PollenLevel | null {
  if (grains == null || !Number.isFinite(grains)) return null;
  if (grains < 1) return "none";
  const [m, h, vh] = NAB[POLLEN_GROUP[type]];
  if (grains >= vh) return "very high";
  if (grains >= h) return "high";
  if (grains >= m) return "moderate";
  return "low";
}

/** Lowest-AQI contiguous window of `hours` in the next 24 h. */
export function bestOutdoorWindow(
  times: readonly number[],
  aqi: ReadonlyArray<number | null>,
  fromTime: number,
  hours = 2,
): { start: number; end: number; meanAqi: number } | null {
  let best: { start: number; end: number; meanAqi: number } | null = null;
  for (let i = 0; i + hours <= times.length; i++) {
    const t = times[i]!;
    if (t < fromTime - 1800 || t > fromTime + 24 * 3600) continue;
    const slice = aqi.slice(i, i + hours);
    if (slice.some((v) => v == null)) continue;
    const m = (slice as number[]).reduce((s, v) => s + v, 0) / hours;
    if (!best || m < best.meanAqi) best = { start: t, end: times[i + hours - 1]! + 3600, meanAqi: m };
  }
  return best;
}
