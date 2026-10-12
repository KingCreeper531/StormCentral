/**
 * Where the forecast comes from, chosen at the top of the Daily page and used
 * everywhere: Open-Meteo's best blend for the location (the default), one
 * national or AI model through Open-Meteo, or Google with the person's own key.
 */

export const FORECAST_SOURCES = [
  { id: "auto", label: "Best match", short: "Open-Meteo", model: null, note: "Open-Meteo's blend of the best national models for your area." },
  { id: "google", label: "Google", short: "Google", model: null, note: "Google's Weather API, with your own API key." },
  { id: "ecmwf", label: "ECMWF (Europe)", short: "ECMWF", model: "ecmwf_ifs025", note: "The European Centre's global model, widely rated the most accurate." },
  { id: "ecmwf_ai", label: "ECMWF AI", short: "ECMWF AI", model: "ecmwf_aifs025_single", note: "The European Centre's machine-learning model." },
  { id: "gfs", label: "NOAA GFS (US)", short: "GFS", model: "gfs_seamless", note: "The US global model, with HRRR for the first hours over the US." },
  { id: "nbm", label: "NWS National Blend", short: "NWS Blend", model: "ncep_nbm_conus", note: "The National Weather Service's statistical blend.", region: "US" },
  { id: "icon", label: "DWD ICON (Germany)", short: "ICON", model: "icon_seamless", note: "The German Weather Service's model." },
  { id: "gem", label: "GEM (Canada)", short: "GEM", model: "gem_seamless", note: "Environment Canada's model." },
  { id: "ukmo", label: "UK Met Office", short: "Met Office", model: "ukmo_seamless", note: "The UK Met Office's global and UK models." },
  { id: "meteofrance", label: "Météo-France", short: "Météo-France", model: "meteofrance_seamless", note: "Météo-France's ARPEGE and AROME models." },
  { id: "jma", label: "JMA (Japan)", short: "JMA", model: "jma_seamless", note: "The Japan Meteorological Agency's model." },
] as const;

export type ForecastSourceId = (typeof FORECAST_SOURCES)[number]["id"];

export interface ForecastSource {
  id: ForecastSourceId;
  label: string;
  short: string;
  /** Open-Meteo `models=` value; null for the default blend and for Google. */
  model: string | null;
  note: string;
  /** Covers only part of the world. */
  region?: string;
}

export const DEFAULT_FORECAST_SOURCE: ForecastSourceId = "auto";

export const isForecastSourceId = (v: unknown): v is ForecastSourceId => FORECAST_SOURCES.some((s) => s.id === v);

export const forecastSource = (id: ForecastSourceId): ForecastSource => FORECAST_SOURCES.find((s) => s.id === id) as ForecastSource;

/** Whether a forecast has temperatures for the next day (regional models return nulls outside their area). */
export function hasForecastData(hourly: { time: number[]; temp: (number | null)[] }, nowMs: number): boolean {
  let count = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i]! * 1000;
    if (t >= nowMs && t < nowMs + 24 * 3_600_000 && hourly.temp[i] != null) count++;
  }
  return count >= 12;
}
