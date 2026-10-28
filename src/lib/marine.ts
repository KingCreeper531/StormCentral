/**
 * Marine conditions on the radar map: NOAA NDBC buoys (lib/feeds/buoys) and
 * the Open-Meteo wave forecast (lib/api/open-meteo-marine). One colour scale
 * for significant wave height serves the buoy dots, the forecast field and
 * its legend, so a buoy reads against the field around it.
 */
import { convertHeight, type HeightUnit } from "./weather/units";

/** Wave height (m) → colour: calm blues, through green and yellow, to the reds and purples of a storm sea. */
export const WAVE_STOPS: readonly (readonly [m: number, color: string])[] = [
  [0, "#2b5c8a"],
  [0.5, "#2f8fbf"],
  [1, "#33b8a8"],
  [1.5, "#6cc24a"],
  [2, "#d6d23a"],
  [3, "#f29b30"],
  [4, "#e4572e"],
  [6, "#b7287a"],
  [9, "#6a1b9a"],
];

/** Heights labelled on the legend (m). */
export const WAVE_LEGEND_M = [0, 1, 2, 3, 4, 6, 9] as const;

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const STOPS_RGB = WAVE_STOPS.map(([m, c]) => [m, hexRgb(c)] as const);

/** The scale's colour for a wave height, blended between stops. */
export function waveRgb(m: number): [number, number, number] {
  const first = STOPS_RGB[0]!;
  if (!(m > first[0])) return first[1];
  for (let i = 1; i < STOPS_RGB.length; i++) {
    const [m1, c1] = STOPS_RGB[i]!;
    if (m <= m1) {
      const [m0, c0] = STOPS_RGB[i - 1]!;
      const k = (m - m0) / (m1 - m0);
      return [0, 1, 2].map((j) => Math.round(c0[j]! + (c1[j]! - c0[j]!) * k)) as [number, number, number];
    }
  }
  return STOPS_RGB[STOPS_RGB.length - 1]![1];
}

/** Where a stop sits on the legend bar (0–1): stops are evenly spaced, so the busy low end isn't squeezed. */
export const waveStopAt = (m: number) => Math.max(0, WAVE_STOPS.findIndex(([s]) => s === m)) / (WAVE_STOPS.length - 1);

/** A CSS gradient of the scale, for the legend bar. */
export const WAVE_GRADIENT = `linear-gradient(to right, ${WAVE_STOPS.map(([m, c]) => `${c} ${(waveStopAt(m) * 100).toFixed(1)}%`).join(", ")})`;

const NF1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** Wave heights need a decimal the app's general height format (whole feet or metres) doesn't give: "1.6 m", "5.2 ft". */
export function formatWaveHeight(m: number | null | undefined, unit: HeightUnit, withUnit = true): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return `${NF1.format(convertHeight(m, unit))}${withUnit ? ` ${unit}` : ""}`;
}

/** A legend tick in the person's unit, whole numbers: 0, 3, 7, 10 ft or 0, 1, 2, 3 m. */
export const waveTick = (m: number, unit: HeightUnit) => NF0.format(convertHeight(m, unit));
