/**
 * Point forecasts for meteograms, from Open-Meteo: several models side by
 * side in one request, or one ensemble's members for a plume. Open-Meteo
 * decodes the models' GRIB files on its side; the browser calls it directly,
 * like the rest of the app's forecasts. Values stay in SI units (°C, mm,
 * m/s, hPa, J/kg) until they're shown.
 *
 * The model lists were checked against the live API (October 2026): which
 * names answer, how far ahead each runs and which variables each carries.
 * GraphCast no longer returns data there, so the AI models are ECMWF's AIFS
 * and NOAA's AI GFS.
 */
import { getJson, qs } from "../api/http";
import type { LatLon } from "../geo";
import { convertPrecip, convertPressure, convertTemp, convertWind, WIND_LABEL, type UnitPrefs } from "./units";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble";

export type MeteoVar = "temp" | "dewpoint" | "precip" | "gust" | "cape" | "pressure";

export const METEO_VARS: Record<MeteoVar, { api: string; label: string; short: string; caption?: string }> = {
  temp: { api: "temperature_2m", label: "Temperature", short: "Temp" },
  dewpoint: { api: "dew_point_2m", label: "Dew point", short: "Dew pt" },
  precip: { api: "precipitation", label: "Rain and snow, total", short: "Precip", caption: "Total from now, with snow as its melted water" },
  gust: { api: "wind_gusts_10m", label: "Wind gusts", short: "Gusts" },
  cape: { api: "cape", label: "CAPE (storm fuel)", short: "CAPE" },
  pressure: { api: "pressure_msl", label: "Sea-level pressure", short: "Pressure" },
};
export const METEO_VAR_IDS = Object.keys(METEO_VARS) as MeteoVar[];

export interface CompareModel {
  /** Open-Meteo `models=` value. */
  id: string;
  label: string;
  note: string;
  ai?: boolean;
  /** Covers only part of the world. */
  region?: "US";
}

/**
 * Models to compare, at most eight (one chart colour each, in this order: a
 * model keeps its colour whatever else is shown).
 */
export const COMPARE_MODELS: readonly CompareModel[] = [
  { id: "ecmwf_ifs025", label: "ECMWF", note: "The European Centre's global model (IFS), 15 days." },
  { id: "gfs_seamless", label: "GFS", note: "NOAA's global model, 16 days." },
  { id: "ecmwf_aifs025_single", label: "ECMWF AI", note: "ECMWF's machine-learning model (AIFS), 15 days. No gusts or CAPE.", ai: true },
  { id: "ncep_hrrr_conus", label: "HRRR", note: "NOAA's 3 km storm-scale model, about 2 days.", region: "US" },
  { id: "icon_seamless", label: "ICON", note: "The German Weather Service's model, about 7 days." },
  { id: "gem_seamless", label: "GEM", note: "Environment Canada's model, 10 days." },
  { id: "ncep_aigfs025", label: "NOAA AI", note: "NOAA's machine-learning GFS, 16 days. No dew point, gusts or CAPE.", ai: true },
  { id: "ncep_nam_conus", label: "NAM 3 km", note: "NOAA's 3 km NAM, about 3 days.", region: "US" },
];

/** Shown until someone picks their own. */
export const DEFAULT_COMPARE = ["ecmwf_ifs025", "gfs_seamless", "ecmwf_aifs025_single", "ncep_hrrr_conus", "icon_seamless"];

export interface Ensemble {
  id: string;
  label: string;
  members: number;
  note: string;
  ai?: boolean;
}

export const ENSEMBLES: readonly Ensemble[] = [
  { id: "ecmwf_ifs025", label: "ECMWF ENS", members: 51, note: "The European Centre's 51-member ensemble, 15 days." },
  { id: "ncep_gefs025", label: "GEFS", members: 31, note: "NOAA's 31-member GFS ensemble, 16 days." },
  { id: "ecmwf_aifs025", label: "ECMWF AI ENS", members: 51, note: "ECMWF's 51-member machine-learning ensemble. No gusts or CAPE.", ai: true },
  { id: "icon_seamless", label: "ICON EPS", members: 40, note: "The German Weather Service's 40-member ensemble. No gusts or CAPE." },
  { id: "gem_global", label: "GEM ENS", members: 21, note: "Environment Canada's 21-member ensemble. No gusts." },
  { id: "ukmo_global_ensemble_20km", label: "UK MOGREPS-G", members: 18, note: "The UK Met Office's 18-member ensemble." },
];

type Series = (number | null)[];

export interface MultiModel {
  /** Valid times, epoch ms. */
  time: number[];
  /** Variable → model id → values (null where the model has none). */
  values: Record<MeteoVar, Record<string, Series>>;
}

export interface EnsembleRun {
  time: number[];
  /** The control run first, then each member; empty when the ensemble doesn't carry the variable. */
  members: Series[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function multiModelUrl(p: LatLon, models: readonly string[], days = 15): string {
  return `${FORECAST_URL}?${qs({
    latitude: round(p.lat),
    longitude: round(p.lon),
    models: models.join(","),
    hourly: METEO_VAR_IDS.map((v) => METEO_VARS[v].api).join(","),
    wind_speed_unit: "ms",
    past_hours: 12,
    // Hours, not days: with past_hours set, Open-Meteo ignores forecast_days and sends everything it has.
    forecast_hours: days * 24,
    timeformat: "unixtime",
    timezone: "GMT",
  })}`;
}

export function ensembleUrl(p: LatLon, ensemble: string, v: MeteoVar, days = 15): string {
  return `${ENSEMBLE_URL}?${qs({
    latitude: round(p.lat),
    longitude: round(p.lon),
    models: ensemble,
    hourly: METEO_VARS[v].api,
    wind_speed_unit: "ms",
    past_hours: 12,
    // Hours, not days: with past_hours set, Open-Meteo ignores forecast_days and sends everything it has.
    forecast_hours: days * 24,
    timeformat: "unixtime",
    timezone: "GMT",
  })}`;
}

interface Raw {
  hourly?: { time?: number[] } & Record<string, unknown>;
}

const series = (v: unknown, length: number): Series =>
  Array.isArray(v) ? v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null)) : new Array<null>(length).fill(null);

/** A multi-model answer: keys carry a `_<model>` suffix, except when only one model was asked for. */
export function parseMultiModel(raw: unknown, models: readonly string[]): MultiModel {
  const h = (raw as Raw).hourly ?? {};
  const time = (h.time ?? []).map((t) => t * 1000);
  const values = {} as MultiModel["values"];
  for (const v of METEO_VAR_IDS) {
    values[v] = {};
    for (const m of models) values[v][m] = series(h[models.length === 1 ? METEO_VARS[v].api : `${METEO_VARS[v].api}_${m}`], time.length);
  }
  return { time, values };
}

/** One ensemble's answer for one variable: `<var>` is the control run, `<var>_memberNN` the rest. */
export function parseEnsemble(raw: unknown, v: MeteoVar): EnsembleRun {
  const h = (raw as Raw).hourly ?? {};
  const time = (h.time ?? []).map((t) => t * 1000);
  const api = METEO_VARS[v].api;
  const keys = Object.keys(h)
    .filter((k) => k === api || new RegExp(`^${api}_member\\d+$`).test(k))
    .sort((a, b) => (a === api ? -1 : b === api ? 1 : a.localeCompare(b, "en", { numeric: true })));
  const members = keys.map((k) => series(h[k], time.length)).filter((s) => s.some((x) => x != null));
  return { time, members };
}

export function fetchMultiModel(p: LatLon, models: readonly string[], signal?: AbortSignal): Promise<MultiModel> {
  return getJson<unknown>(multiModelUrl(p, models), { signal, timeoutMs: 20_000 }).then((d) => parseMultiModel(d, models));
}

export function fetchEnsemble(p: LatLon, ensemble: string, v: MeteoVar, signal?: AbortSignal): Promise<EnsembleRun> {
  return getJson<unknown>(ensembleUrl(p, ensemble, v), { signal, timeoutMs: 25_000 }).then((d) => parseEnsemble(d, v));
}

/**
 * Precipitation as the total from `start` (an index) on: what a plume of
 * rainfall shows. Earlier hours are null; a missing hour keeps the total
 * flat until the model resumes, and an all-missing series stays missing.
 */
export function accumulate(s: Series, start: number): Series {
  let total = 0;
  let any = false;
  return s.map((v, i) => {
    if (i < start) return null;
    if (v != null) {
      total += Math.max(0, v);
      any = true;
    }
    return any ? total : null;
  });
}

/** The first index at or after `now`, or 0. */
export function startIndex(time: readonly number[], now: number): number {
  const i = time.findIndex((t) => t >= now - 30 * 60_000);
  return i < 0 ? 0 : i;
}

export interface PlumeStats {
  mean: Series;
  p10: Series;
  p90: Series;
  min: Series;
  max: Series;
}

/** Linear-interpolated quantile of sorted values. */
function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Mean, 10th–90th percentile and range across members at each time (null where fewer than half the members have a value). */
export function plumeStats(members: readonly Series[]): PlumeStats {
  const n = members[0]?.length ?? 0;
  const out: PlumeStats = { mean: [], p10: [], p90: [], min: [], max: [] };
  for (let i = 0; i < n; i++) {
    const vals = members.map((m) => m[i]).filter((v): v is number => v != null).sort((a, b) => a - b);
    if (vals.length < Math.max(1, members.length / 2)) {
      for (const k of Object.keys(out) as (keyof PlumeStats)[]) out[k].push(null);
      continue;
    }
    out.mean.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    out.p10.push(quantile(vals, 0.1));
    out.p90.push(quantile(vals, 0.9));
    out.min.push(vals[0]!);
    out.max.push(vals.at(-1)!);
  }
  return out;
}

/** Whether a model has any value for a variable (models leave out what they don't forecast). */
export const hasData = (s: Series | undefined) => !!s && s.some((v) => v != null);

export interface DisplayScale {
  /** SI value → the person's unit. */
  convert: (si: number) => number;
  /** A converted value with its unit, for the readout and table. */
  format: (x: number) => string;
  /** A converted value for the axis. */
  axis: (x: number) => string;
  unit: string;
}

const trim = (x: number, digits: number) => String(Number(x.toFixed(digits)));

/** How a variable is shown in the person's units. */
export function displayScale(v: MeteoVar, u: UnitPrefs): DisplayScale {
  switch (v) {
    case "temp":
    case "dewpoint":
      return { convert: (c) => convertTemp(c, u.temp), format: (x) => `${Math.round(x)}°${u.temp}`, axis: (x) => `${Math.round(x)}°`, unit: `°${u.temp}` };
    case "precip": {
      const d = u.precip === "in" ? 2 : 1;
      return { convert: (mm) => convertPrecip(mm, u.precip), format: (x) => `${x.toFixed(d)}\u00a0${u.precip}`, axis: (x) => trim(x, d), unit: u.precip };
    }
    case "gust":
      return { convert: (ms) => convertWind(ms, u.wind), format: (x) => `${Math.round(x)}\u00a0${WIND_LABEL[u.wind]}`, axis: (x) => `${Math.round(x)}`, unit: WIND_LABEL[u.wind] };
    case "cape":
      return { convert: (j) => j, format: (x) => `${Math.round(x).toLocaleString()}\u00a0J/kg`, axis: (x) => Math.round(x).toLocaleString(), unit: "J/kg" };
    case "pressure": {
      const d = u.pressure === "inHg" ? 2 : 0;
      return { convert: (hPa) => convertPressure(hPa, u.pressure), format: (x) => `${x.toFixed(d)}\u00a0${u.pressure}`, axis: (x) => trim(x, d), unit: u.pressure };
    }
  }
}
