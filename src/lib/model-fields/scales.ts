/**
 * Colour scales for the model maps on the radar (Windy/Ventusky-style fields
 * from Open-Meteo). Values are in the units Open-Meteo sends (m/s, °C, J/kg,
 * mm and cm per hour); only the legend converts to the person's units.
 * Pure, so the scales can be tested and shared by the map and the legend.
 */
import { convertPrecip, convertTemp, convertWind, WIND_LABEL, type UnitPrefs } from "../weather/units";

export const MODEL_FIELDS = ["wind", "temp", "gusts", "cape", "precip", "snow"] as const;
export type ModelFieldId = (typeof MODEL_FIELDS)[number];
/** The radar setting: a field, or the model maps off. */
export type ModelFieldSetting = ModelFieldId | "off";

export const isModelFieldSetting = (v: unknown): v is ModelFieldSetting => v === "off" || (MODEL_FIELDS as readonly unknown[]).includes(v);

/** Open-Meteo hourly variables behind the fields (wind direction drives the particles). */
export type ModelVariable = "wind_speed_10m" | "wind_direction_10m" | "wind_gusts_10m" | "temperature_2m" | "cape" | "precipitation" | "snowfall";

type Rgba = readonly [number, number, number, number];

export interface ColorStop {
  value: number;
  color: Rgba;
}

export interface FieldDef {
  /** English label (translated where shown). */
  label: string;
  variable: ModelVariable;
  kind: "wind" | "temp" | "cape" | "precip" | "snow";
  /** Ascending by value. Below the first stop takes its colour, above the last the last's. */
  stops: readonly ColorStop[];
  /** Stop values the legend labels. */
  ticks: readonly number[];
  /** Whether the field paints everywhere (so white particles always have a backdrop). */
  opaque: boolean;
}

const WIND_STOPS: readonly ColorStop[] = [
  { value: 0, color: [98, 113, 183, 255] },
  { value: 3, color: [57, 135, 175, 255] },
  { value: 6, color: [74, 160, 128, 255] },
  { value: 9, color: [77, 168, 72, 255] },
  { value: 12, color: [178, 172, 70, 255] },
  { value: 15, color: [205, 128, 56, 255] },
  { value: 19, color: [192, 64, 74, 255] },
  { value: 24, color: [168, 60, 148, 255] },
  { value: 30, color: [118, 72, 170, 255] },
  { value: 40, color: [226, 226, 240, 255] },
];

export const FIELDS: Record<ModelFieldId, FieldDef> = {
  wind: { label: "Wind", variable: "wind_speed_10m", kind: "wind", stops: WIND_STOPS, ticks: [0, 6, 12, 19, 30], opaque: true },
  gusts: { label: "Wind gusts", variable: "wind_gusts_10m", kind: "wind", stops: WIND_STOPS, ticks: [0, 6, 12, 19, 30], opaque: true },
  temp: {
    label: "Temperature",
    variable: "temperature_2m",
    kind: "temp",
    stops: [
      { value: -40, color: [140, 40, 170, 255] },
      { value: -30, color: [110, 70, 200, 255] },
      { value: -20, color: [60, 90, 210, 255] },
      { value: -10, color: [60, 150, 220, 255] },
      { value: 0, color: [130, 210, 235, 255] },
      { value: 5, color: [90, 195, 150, 255] },
      { value: 10, color: [120, 195, 80, 255] },
      { value: 15, color: [205, 210, 70, 255] },
      { value: 20, color: [240, 175, 55, 255] },
      { value: 25, color: [235, 115, 45, 255] },
      { value: 30, color: [210, 55, 45, 255] },
      { value: 35, color: [160, 25, 60, 255] },
      { value: 45, color: [100, 10, 45, 255] },
    ],
    ticks: [-30, -10, 10, 25, 45],
    opaque: true,
  },
  // Fuel for thunderstorms: clear where there is next to none, so the map underneath shows.
  cape: {
    label: "CAPE",
    variable: "cape",
    kind: "cape",
    stops: [
      { value: 50, color: [60, 120, 200, 0] },
      { value: 250, color: [60, 130, 210, 150] },
      { value: 500, color: [70, 185, 105, 190] },
      { value: 1000, color: [220, 215, 60, 210] },
      { value: 2000, color: [240, 145, 40, 225] },
      { value: 3000, color: [220, 50, 40, 235] },
      { value: 4000, color: [185, 40, 160, 245] },
      { value: 6000, color: [245, 200, 245, 255] },
    ],
    ticks: [250, 1000, 2000, 4000],
    opaque: false,
  },
  // The hour's total; under a tenth of a millimetre stays clear.
  precip: {
    label: "Precipitation",
    variable: "precipitation",
    kind: "precip",
    stops: [
      { value: 0.05, color: [110, 190, 250, 0] },
      { value: 0.2, color: [110, 190, 250, 170] },
      { value: 1, color: [40, 130, 230, 210] },
      { value: 2.5, color: [40, 185, 90, 225] },
      { value: 5, color: [240, 215, 50, 235] },
      { value: 10, color: [240, 130, 30, 245] },
      { value: 20, color: [220, 30, 30, 255] },
      { value: 40, color: [200, 40, 200, 255] },
    ],
    ticks: [0.2, 1, 5, 20, 40],
    opaque: false,
  },
  snow: {
    label: "Snowfall",
    variable: "snowfall",
    kind: "snow",
    stops: [
      { value: 0.03, color: [200, 225, 255, 0] },
      { value: 0.1, color: [200, 225, 255, 160] },
      { value: 0.5, color: [140, 180, 250, 200] },
      { value: 1, color: [90, 130, 240, 225] },
      { value: 2, color: [105, 70, 220, 240] },
      { value: 4, color: [180, 60, 220, 250] },
      { value: 8, color: [250, 185, 250, 255] },
    ],
    ticks: [0.1, 1, 2, 4, 8],
    opaque: false,
  },
};

/**
 * Writes the colour of `v` into `out` at `offset` (RGBA bytes), blending
 * linearly between stops. Missing values are left fully transparent.
 */
export function writeColor(stops: readonly ColorStop[], v: number, out: Uint8ClampedArray | number[], offset = 0): void {
  if (!Number.isFinite(v)) {
    out[offset] = out[offset + 1] = out[offset + 2] = out[offset + 3] = 0;
    return;
  }
  let hi = 0;
  while (hi < stops.length && stops[hi]!.value < v) hi++;
  const a = stops[Math.max(0, hi - 1)]!;
  const b = stops[Math.min(stops.length - 1, hi)]!;
  const f = b.value === a.value ? 0 : (v - a.value) / (b.value - a.value);
  for (let k = 0; k < 4; k++) out[offset + k] = Math.round(a.color[k]! + (b.color[k]! - a.color[k]!) * f);
}

/** RGBA of `v` (tests and one-off lookups; the map writes straight into its image). */
export function colorAt(stops: readonly ColorStop[], v: number): [number, number, number, number] {
  const out = [0, 0, 0, 0];
  writeColor(stops, v, out);
  return out as [number, number, number, number];
}

/**
 * CSS gradient for the legend. Stops are spaced evenly rather than by value:
 * precipitation runs from 0.2 to 40 mm, and a linear bar would squeeze all
 * the common amounts into its first few pixels. Transparent stops show as the
 * first visible colour, faded, so the bar reads on any background.
 */
export function legendGradient(stops: readonly ColorStop[]): string {
  const n = stops.length - 1;
  const parts = stops.map((s, i) => {
    const [r, g, b, a] = s.color;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0.25, a / 255).toFixed(2)}) ${((i / n) * 100).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/** Where a stop value sits along the evenly spaced legend (0–1). */
export function legendPosition(stops: readonly ColorStop[], value: number): number {
  const i = stops.findIndex((s) => s.value >= value);
  if (i <= 0) return 0;
  const a = stops[i - 1]!;
  const b = stops[i]!;
  return (i - 1 + (value - a.value) / (b.value - a.value)) / (stops.length - 1);
}

/** The legend's unit in the person's units. */
export function legendUnit(def: FieldDef, units: UnitPrefs): string {
  switch (def.kind) {
    case "wind":
      return WIND_LABEL[units.wind];
    case "temp":
      return `°${units.temp}`;
    case "cape":
      return "J/kg";
    case "precip":
      return units.precip === "in" ? "in/h" : "mm/h";
    case "snow":
      return units.precip === "in" ? "in/h" : "cm/h";
  }
}

const round = (v: number, digits: number) => {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? 0 : r;
};

/** A legend tick in the person's units, without the unit ("68", "0.04"). */
export function legendValue(def: FieldDef, v: number, units: UnitPrefs): string {
  switch (def.kind) {
    case "wind":
      return String(round(convertWind(v, units.wind), 0));
    case "temp":
      return String(round(convertTemp(v, units.temp), 0));
    case "cape":
      return String(v);
    case "precip": {
      const x = convertPrecip(v, units.precip);
      return String(round(x, x < 0.1 ? 2 : x < 10 ? 1 : 0));
    }
    case "snow": {
      const x = units.precip === "in" ? v / 2.54 : v;
      return String(round(x, x < 0.1 ? 2 : x < 10 ? 1 : 0));
    }
  }
}
