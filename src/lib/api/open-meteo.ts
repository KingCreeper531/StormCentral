/**
 * Open-Meteo clients (forecast, air quality, geocoding). Called directly from
 * the browser: the API is CORS-enabled, free, and per-IP rate limits mean
 * each user spends their own quota rather than a shared server key's.
 *
 * Responses are kept columnar (struct-of-arrays) exactly as delivered — every
 * mode reads the same normalised forecast, so switching modes never refetches.
 */
import type { BBox } from "../geo";
import { latFromMercatorY, mercatorY } from "../geo";
import { getJson, HttpError, qs } from "./http";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

type Series = (number | null)[];

const HOURLY_VARS = {
  temperature_2m: "temp",
  relative_humidity_2m: "rh",
  dew_point_2m: "dewPoint",
  apparent_temperature: "feelsLike",
  precipitation_probability: "precipProb",
  precipitation: "precip",
  snowfall: "snowfall",
  weather_code: "code",
  pressure_msl: "pressureMsl",
  surface_pressure: "surfacePressure",
  cloud_cover: "cloud",
  cloud_cover_low: "cloudLow",
  cloud_cover_mid: "cloudMid",
  cloud_cover_high: "cloudHigh",
  visibility: "visibility",
  wind_speed_10m: "wind10",
  wind_speed_80m: "wind80",
  wind_speed_120m: "wind120",
  wind_speed_180m: "wind180",
  wind_direction_10m: "dir10",
  wind_direction_80m: "dir80",
  wind_direction_120m: "dir120",
  wind_direction_180m: "dir180",
  wind_gusts_10m: "gust10",
  uv_index: "uv",
  is_day: "isDay",
  cape: "cape",
} as const;

const DAILY_VARS = {
  weather_code: "code",
  temperature_2m_max: "tMax",
  temperature_2m_min: "tMin",
  sunrise: "sunrise",
  sunset: "sunset",
  uv_index_max: "uvMax",
  precipitation_sum: "precipSum",
  precipitation_probability_max: "precipProbMax",
  wind_speed_10m_max: "windMax",
  wind_gusts_10m_max: "gustMax",
  wind_direction_10m_dominant: "windDir",
  daylight_duration: "daylight",
} as const;

const CURRENT_VARS = {
  temperature_2m: "temp",
  relative_humidity_2m: "rh",
  apparent_temperature: "feelsLike",
  is_day: "isDay",
  precipitation: "precip",
  weather_code: "code",
  cloud_cover: "cloud",
  pressure_msl: "pressureMsl",
  surface_pressure: "surfacePressure",
  wind_speed_10m: "windSpeed",
  wind_direction_10m: "windDir",
  wind_gusts_10m: "windGust",
} as const;

/** Variables present on every model — used for the degraded retry. */
const CORE_HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "pressure_msl",
  "surface_pressure",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "is_day",
] as const;

type HourlyKey = (typeof HOURLY_VARS)[keyof typeof HOURLY_VARS];
type DailyKey = (typeof DAILY_VARS)[keyof typeof DAILY_VARS];
type CurrentKey = (typeof CURRENT_VARS)[keyof typeof CURRENT_VARS];

export interface Forecast {
  lat: number;
  lon: number;
  elevation: number;
  timezone: string;
  utcOffsetSeconds: number;
  fetchedAt: number;
  /** Epoch seconds of the observation-time model snapshot. */
  current: Record<CurrentKey, number | null> & { time: number };
  hourly: Record<HourlyKey, Series> & { time: number[] };
  daily: Record<DailyKey, Series> & { time: number[] };
  minutely15: { time: number[]; precip: Series } | null;
}

interface RawBlock {
  time: number[] | number;
  [k: string]: unknown;
}

interface RawForecast {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  utc_offset_seconds: number;
  current?: RawBlock;
  hourly?: RawBlock;
  daily?: RawBlock;
  minutely_15?: RawBlock;
}

function remap<K extends string>(block: RawBlock | undefined, vars: Record<string, K>, length: number) {
  const out = {} as Record<K, Series>;
  for (const [api, key] of Object.entries(vars)) {
    const v = block?.[api];
    out[key] = Array.isArray(v) ? (v as Series) : new Array<null>(length).fill(null);
  }
  return out;
}

/**
 * Forecast request URL. `core` asks only for variables every model has
 * (the retry after a 400 for an unsupported variable).
 */
export function forecastUrl(lat: number, lon: number, variant: "full" | "core" = "full") {
  const base = {
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    timezone: "auto",
    timeformat: "unixtime",
    wind_speed_unit: "ms",
    past_days: 1,
    forecast_days: 10,
    current: Object.keys(CURRENT_VARS),
    daily: Object.keys(DAILY_VARS),
  };
  return variant === "core"
    ? `${FORECAST_URL}?${qs({ ...base, hourly: CORE_HOURLY })}`
    : `${FORECAST_URL}?${qs({ ...base, hourly: Object.keys(HOURLY_VARS), minutely_15: "precipitation", forecast_minutely_15: 12, past_minutely_15: 0 })}`;
}

/** Normalise a raw Open-Meteo forecast response (pure; also used by the Android background runner). */
export function parseForecast(input: unknown, fetchedAt = Date.now()): Forecast {
  const raw = input as RawForecast;
  const hTime = (raw.hourly?.time as number[]) ?? [];
  const dTime = (raw.daily?.time as number[]) ?? [];
  const current = {} as Forecast["current"];
  for (const [api, key] of Object.entries(CURRENT_VARS)) {
    const v = raw.current?.[api];
    current[key] = typeof v === "number" ? v : null;
  }
  current.time = (raw.current?.time as number) ?? Math.floor(fetchedAt / 1000);

  const m = raw.minutely_15;
  return {
    lat: raw.latitude,
    lon: raw.longitude,
    elevation: raw.elevation,
    timezone: raw.timezone,
    utcOffsetSeconds: raw.utc_offset_seconds,
    fetchedAt,
    current,
    hourly: { time: hTime, ...remap(raw.hourly, HOURLY_VARS, hTime.length) },
    daily: { time: dTime, ...remap(raw.daily, DAILY_VARS, dTime.length) },
    minutely15:
      m && Array.isArray(m.time) && Array.isArray(m.precipitation)
        ? { time: m.time as number[], precip: m.precipitation as Series }
        : null,
  };
}

export async function fetchForecast(lat: number, lon: number, signal?: AbortSignal): Promise<Forecast> {
  let raw: RawForecast;
  try {
    raw = await getJson<RawForecast>(forecastUrl(lat, lon), { signal });
  } catch (err) {
    // A 400 means a variable/parameter isn't supported for this point —
    // degrade to the universally available core set instead of failing.
    if (!(err instanceof HttpError) || err.status !== 400) throw err;
    raw = await getJson<RawForecast>(forecastUrl(lat, lon, "core"), { signal });
  }
  return parseForecast(raw);
}

// ─── Air quality ────────────────────────────────────────────────────────────

const AIR_HOURLY = {
  us_aqi: "usAqi",
  european_aqi: "euAqi",
  pm2_5: "pm25",
  pm10: "pm10",
  ozone: "o3",
  nitrogen_dioxide: "no2",
  sulphur_dioxide: "so2",
  carbon_monoxide: "co",
  uv_index: "uv",
  dust: "dust",
  alder_pollen: "alder",
  birch_pollen: "birch",
  olive_pollen: "olive",
  grass_pollen: "grass",
  mugwort_pollen: "mugwort",
  ragweed_pollen: "ragweed",
} as const;

type AirKey = (typeof AIR_HOURLY)[keyof typeof AIR_HOURLY];

export interface AirQuality {
  timezone: string;
  fetchedAt: number;
  hourly: Record<AirKey, Series> & { time: number[] };
}

export function airQualityUrl(lat: number, lon: number) {
  return `${AIR_URL}?${qs({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    timezone: "auto",
    timeformat: "unixtime",
    past_days: 1,
    forecast_days: 5,
    hourly: Object.keys(AIR_HOURLY),
  })}`;
}

/** Normalise a raw air-quality response (pure; also used by the Android background runner). */
export function parseAirQuality(input: unknown, fetchedAt = Date.now()): AirQuality {
  const raw = input as { timezone: string; hourly?: RawBlock };
  const time = (raw.hourly?.time as number[]) ?? [];
  return { timezone: raw.timezone, fetchedAt, hourly: { time, ...remap(raw.hourly, AIR_HOURLY, time.length) } };
}

export async function fetchAirQuality(lat: number, lon: number, signal?: AbortSignal): Promise<AirQuality> {
  return parseAirQuality(await getJson(airQualityUrl(lat, lon), { signal }));
}

export type GridVariable = "us_aqi" | "pm2_5";

export interface ValueGrid {
  bbox: BBox;
  cols: number;
  rows: number;
  /** Row-major from north-west; NaN where missing. */
  values: Float32Array;
  variable: GridVariable;
}

/**
 * Samples a model field on a grid evenly spaced in *Web-Mercator* space, so
 * the resulting image drapes onto the map without vertical distortion.
 * One multi-location request covers the whole grid.
 */
export async function fetchAirGrid(
  bbox: BBox,
  variable: GridVariable,
  cols = 12,
  rows = 9,
  signal?: AbortSignal,
): Promise<ValueGrid> {
  // Zoomed far out, the view runs past ±180° longitude and the Mercator limit:
  // the API rejects those points, and an overlay placed there breaks map rendering.
  bbox = {
    west: Math.max(-180, Math.min(180, bbox.west)),
    east: Math.max(-180, Math.min(180, bbox.east)),
    north: Math.max(-84, Math.min(84, bbox.north)),
    south: Math.max(-84, Math.min(84, bbox.south)),
  };
  if (bbox.east <= bbox.west || bbox.north <= bbox.south) bbox = { west: -180, east: 180, north: 84, south: -84 };
  const yN = mercatorY(bbox.north);
  const yS = mercatorY(bbox.south);
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = latFromMercatorY(yN + ((yS - yN) * (r + 0.5)) / rows);
    for (let c = 0; c < cols; c++) {
      lats.push(+lat.toFixed(3));
      lons.push(+(bbox.west + ((bbox.east - bbox.west) * (c + 0.5)) / cols).toFixed(3));
    }
  }
  const raw = await getJson<{ current?: Record<string, number | null> }[] | { current?: Record<string, number | null> }>(
    `${AIR_URL}?${qs({ latitude: lats, longitude: lons, current: variable, timezone: "GMT" })}`,
    { signal, timeoutMs: 20_000 },
  );
  const list = Array.isArray(raw) ? raw : [raw];
  const values = new Float32Array(cols * rows).fill(Number.NaN);
  list.forEach((r, i) => {
    const v = r.current?.[variable];
    if (typeof v === "number") values[i] = v;
  });
  return { bbox, cols, rows, values, variable };
}

// ─── Geocoding ──────────────────────────────────────────────────────────────

export interface Place {
  id: string;
  name: string;
  region: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const raw = await getJson<{
    results?: {
      id: number;
      name: string;
      admin1?: string;
      country?: string;
      country_code?: string;
      latitude: number;
      longitude: number;
    }[];
  }>(`${GEOCODE_URL}?${qs({ name: q, count: 8, language: "en", format: "json" })}`, { signal });
  return (raw.results ?? []).map((r) => ({
    id: String(r.id),
    name: r.name,
    region: r.admin1 ?? "",
    country: r.country ?? "",
    countryCode: r.country_code ?? "",
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** Keyless client-side reverse geocoding (BigDataCloud's free client endpoint). */
export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  const r = await getJson<{ city?: string; locality?: string; principalSubdivisionCode?: string; countryCode?: string }>(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?${qs({ latitude: lat, longitude: lon, localityLanguage: "en" })}`,
    { signal, timeoutMs: 8000 },
  );
  const name = r.city || r.locality || "My location";
  const region = r.principalSubdivisionCode?.split("-")[1];
  return region ? `${name}, ${region}` : name;
}
