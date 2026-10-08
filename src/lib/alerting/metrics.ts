/**
 * Custom-alert metrics: what can be watched, how it is computed per hour, and
 * how it is described. Pure; shared by the settings UI, the in-page watcher
 * and the Android background runner.
 */
import type { AirQuality, Forecast } from "../api/open-meteo";
import { DRONE_PROFILES } from "../science/scores";
import { windAtHeight } from "../science/wind";
import type { TempUnit, WindUnit } from "../weather/units";
import { anglerModel, flyabilityAt, windProfileAt } from "../weather/hourly-scores";
import { hourRange } from "../weather/view";
import { convertWindMs, formatTemp, WIND_LABEL, windToMs } from "./format";
import type { RuleMetric, RuleOp } from "./types";

export type MetricGroup = "Daily" | "UAV pilot" | "Angler" | "Air quality";
type ValueKind = "temp" | "wind" | "percent" | "score" | "aqi" | "uv";

export interface MetricDef {
  id: RuleMetric;
  group: MetricGroup;
  /** Sentence-case noun phrase: "Temperature", "Wind at flight altitude". */
  label: string;
  kind: ValueKind;
  defaultOp: RuleOp;
  /** Default threshold, canonical units. */
  defaultValue: number;
  /** Needs the air-quality feed rather than the forecast. */
  air?: boolean;
}

export const METRICS: readonly MetricDef[] = [
  { id: "temp", group: "Daily", label: "Temperature", kind: "temp", defaultOp: "below", defaultValue: 0 },
  { id: "gust", group: "Daily", label: "Wind gusts", kind: "wind", defaultOp: "above", defaultValue: 17.9 },
  { id: "precipProb", group: "Daily", label: "Chance of rain", kind: "percent", defaultOp: "above", defaultValue: 70 },
  { id: "uv", group: "Daily", label: "UV index", kind: "uv", defaultOp: "above", defaultValue: 8 },
  { id: "uavWind", group: "UAV pilot", label: "Wind at flight altitude", kind: "wind", defaultOp: "below", defaultValue: 6.7 },
  { id: "flyability", group: "UAV pilot", label: "Flyability score", kind: "score", defaultOp: "above", defaultValue: 80 },
  { id: "bite", group: "Angler", label: "Bite index", kind: "score", defaultOp: "above", defaultValue: 70 },
  { id: "aqi", group: "Air quality", label: "US AQI", kind: "aqi", defaultOp: "above", defaultValue: 100, air: true },
];

export const metricDef = (id: RuleMetric): MetricDef => METRICS.find((m) => m.id === id) ?? METRICS[0]!;

export interface UnitsLike {
  temp: TempUnit;
  wind: WindUnit;
}

/** Canonical value → number shown in the user's units. */
export function toDisplay(kind: ValueKind, v: number, units: UnitsLike): number {
  if (kind === "temp") return units.temp === "F" ? (v * 9) / 5 + 32 : v;
  if (kind === "wind") return convertWindMs(v, units.wind);
  return v;
}

/** Number in the user's units → canonical value. */
export function fromDisplay(kind: ValueKind, v: number, units: UnitsLike): number {
  if (kind === "temp") return units.temp === "F" ? ((v - 32) * 5) / 9 : v;
  if (kind === "wind") return windToMs(v, units.wind);
  return v;
}

export function unitLabel(kind: ValueKind, units: UnitsLike): string {
  return kind === "temp" ? `°${units.temp}` : kind === "wind" ? WIND_LABEL[units.wind] : kind === "percent" ? "%" : "";
}

export function formatMetric(kind: ValueKind, v: number, units: UnitsLike): string {
  if (kind === "temp") return formatTemp(v, units.temp);
  const shown = toDisplay(kind, v, units);
  const n = kind === "uv" ? Math.round(shown * 10) / 10 : Math.round(shown);
  const unit = unitLabel(kind, units);
  return unit === "%" ? `${n}%` : unit ? `${n} ${unit}` : String(n);
}

/** "Bite index above 70" */
export function describeRule(metric: RuleMetric, op: RuleOp, value: number, units: UnitsLike): string {
  const def = metricDef(metric);
  return `${def.label} ${op} ${formatMetric(def.kind, value, units)}`;
}

export interface MetricContext {
  forecast: Forecast;
  air: AirQuality | null;
  now: number;
  lat: number;
  lon: number;
  drone: { altitudeM: number; profileId: string };
}

/** Hourly values of a metric from now over `hours` (epoch ms, value or null). */
export function metricSeries(metric: RuleMetric, ctx: MetricContext, hours: number): { t: number; v: number | null }[] {
  const f = ctx.forecast;
  if (metric === "aqi") {
    const a = ctx.air;
    if (!a) return [];
    const t0 = ctx.now - 3_600_000;
    return a.hourly.time
      .map((s, i) => ({ t: s * 1000, v: a.hourly.usAqi[i] ?? null }))
      .filter((p) => p.t >= t0 && p.t <= ctx.now + hours * 3_600_000);
  }
  if (metric === "bite") {
    return anglerModel(f, ctx.now, ctx.lat, ctx.lon, { count: hours }).hours.map((h) => ({ t: h.t, v: h.bite.score }));
  }
  const idx = hourRange(f, ctx.now, hours).idx;
  const profile = DRONE_PROFILES.find((p) => p.id === ctx.drone.profileId) ?? DRONE_PROFILES[0]!;
  return idx.map((i) => {
    const t = f.hourly.time[i]! * 1000;
    switch (metric) {
      case "temp":
        return { t, v: f.hourly.temp[i] ?? null };
      case "gust":
        return { t, v: f.hourly.gust10[i] ?? null };
      case "precipProb":
        return { t, v: f.hourly.precipProb[i] ?? null };
      case "uv":
        return { t, v: f.hourly.uv[i] ?? null };
      case "uavWind":
        return { t, v: windAtHeight(windProfileAt(f, i), ctx.drone.altitudeM)?.speedMs ?? f.hourly.wind10[i] ?? null };
      case "flyability":
        return { t, v: flyabilityAt(f, i, { altitudeM: ctx.drone.altitudeM, profile, lat: ctx.lat, lon: ctx.lon }).result.score };
      default:
        return { t, v: null };
    }
  });
}

/** First hour in the window meeting the rule, or null. */
export function firstHit(series: { t: number; v: number | null }[], op: RuleOp, value: number) {
  for (const p of series) {
    if (p.v == null) continue;
    if (op === "above" ? p.v > value : p.v < value) return { t: p.t, v: p.v };
  }
  return null;
}
