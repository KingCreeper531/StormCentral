/**
 * Forecast sources for the comparison panel. Every model except Google's own
 * API comes free through Open-Meteo (`models=`), so people can line up any two:
 * the app's main forecast, Google, ECMWF, NOAA GFS, national models and AI models.
 */
import type { Forecast } from "./api/open-meteo";
import type { GoogleWeather } from "./google-weather";

export interface CompareSource {
  id: CompareSourceId;
  /** "ECMWF (Europe)". */
  label: string;
  /** "ECMWF": for tight spots like the nowcast line. */
  short: string;
  /** Open-Meteo `models=` value; null for the app's own forecast and for Google. */
  model: string | null;
  note: string;
  /** Covers only part of the world. */
  region?: string;
}

export const COMPARE_SOURCES = [
  { id: "app", label: "StormCentral forecast", short: "StormCentral", model: null, note: "The forecast the rest of the app shows: Open-Meteo's best blend of national models for your area." },
  { id: "google", label: "Google AI", short: "Google", model: null, note: "Google's Weather API, with your own API key (Settings)." },
  { id: "ecmwf", label: "ECMWF (Europe)", short: "ECMWF", model: "ecmwf_ifs025", note: "The European Centre's global model, widely rated the most accurate." },
  { id: "ecmwf_ai", label: "ECMWF AI (AIFS)", short: "ECMWF AI", model: "ecmwf_aifs025_single", note: "The European Centre's machine-learning model." },
  { id: "gfs", label: "NOAA GFS (US)", short: "GFS", model: "gfs_seamless", note: "The US global model (with HRRR for the first hours over the US)." },
  { id: "nbm", label: "NWS National Blend", short: "NBM", model: "ncep_nbm_conus", note: "The National Weather Service's statistical blend, the starting point for NWS forecasts.", region: "US" },
  { id: "icon", label: "DWD ICON (Germany)", short: "ICON", model: "icon_seamless", note: "The German Weather Service's model." },
  { id: "gem", label: "GEM (Canada)", short: "GEM", model: "gem_seamless", note: "Environment Canada's model." },
  { id: "ukmo", label: "UK Met Office", short: "Met Office", model: "ukmo_seamless", note: "The UK Met Office's global and UK models." },
  { id: "meteofrance", label: "Météo-France", short: "Météo-France", model: "meteofrance_seamless", note: "Météo-France's ARPEGE and AROME models." },
  { id: "jma", label: "JMA (Japan)", short: "JMA", model: "jma_seamless", note: "The Japan Meteorological Agency's model." },
] as const;

export type CompareSourceId = (typeof COMPARE_SOURCES)[number]["id"];

export const isCompareSourceId = (v: unknown): v is CompareSourceId => COMPARE_SOURCES.some((s) => s.id === v);

export const compareSource = (id: CompareSourceId): CompareSource => COMPARE_SOURCES.find((s) => s.id === id) as CompareSource;

/** The default pairing: the app's forecast against ECMWF's (no key needed). */
export const DEFAULT_COMPARE = { a: "app", b: "ecmwf" } as const satisfies { a: CompareSourceId; b: CompareSourceId };

/** Open-Meteo request for one model (hourly to 10 days; models without a variable return nulls for it). */
export function modelUrl(model: string, lat: number, lon: number) {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&models=${model}` +
    "&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,cloud_cover&timezone=auto&forecast_days=10&timeformat=unixtime"
  );
}

/** The app's own forecast in the comparison shape (no fetch: it's already loaded). */
export function seriesFromForecast(f: Forecast, nowMs: number): GoogleWeather {
  const hours: GoogleWeather["hours"] = [];
  f.hourly.time.forEach((t, i) => {
    const tempC = f.hourly.temp[i];
    if (tempC == null) return;
    hours.push({
      time: new Date(t * 1000).toISOString(),
      tempC,
      code: f.hourly.code[i] ?? 3,
      text: null,
      isDay: (f.hourly.isDay[i] ?? 1) === 1,
      precipChance: f.hourly.precipProb[i] ?? null,
      precipMm: f.hourly.precip[i] ?? null,
    });
  });
  const today = new Date(nowMs + f.utcOffsetSeconds * 1000).toISOString().slice(0, 10);
  const days: GoogleWeather["days"] = [];
  f.daily.time.forEach((t, i) => {
    const date = new Date((t + f.utcOffsetSeconds) * 1000).toISOString().slice(0, 10);
    if (date < today) return;
    days.push({ date, hiC: f.daily.tMax[i] ?? null, loC: f.daily.tMin[i] ?? null, code: f.daily.code[i] ?? 3, text: null, precipChance: f.daily.precipProbMax[i] ?? null, precipMm: f.daily.precipSum[i] ?? null });
  });
  const c = f.current;
  return {
    timeZone: f.timezone,
    current: c.temp == null ? null : { tempC: c.temp, feelsC: c.feelsLike, text: null, code: c.code ?? 3, isDay: (c.isDay ?? 1) === 1, humidity: c.rh, windMs: c.windSpeed, gustMs: c.windGust, windDeg: c.windDir, precipChance: null, thunderChance: null, uv: null },
    hours,
    days,
    fetchedAt: f.fetchedAt,
  };
}

/** Sum of precipitation (mm) in the hours starting within (from, to], or null when the source gives no amounts. */
export function precipBetween(s: GoogleWeather, fromMs: number, toMs: number): number | null {
  let total = 0;
  let any = false;
  for (const h of s.hours) {
    const t = Date.parse(h.time);
    if (t <= fromMs || t > toMs || h.precipMm == null) continue;
    total += h.precipMm;
    any = true;
  }
  return any ? total : null;
}
