/**
 * Google Weather API (Google Maps Platform), normalised for the app. Google's
 * forecasts come from its AI weather models; the app shows them beside the
 * Open-Meteo forecast. Types and parsing are shared; fetching is server-only
 * (lib/server/google-weather.ts) because it needs the API key.
 */

export interface GoogleWeather {
  timeZone: string | null;
  current: {
    tempC: number | null;
    feelsC: number | null;
    text: string | null;
    code: number;
    isDay: boolean;
    humidity: number | null;
    windMs: number | null;
    gustMs: number | null;
    windDeg: number | null;
    precipChance: number | null;
    thunderChance: number | null;
    uv: number | null;
  } | null;
  hours: { time: string; tempC: number | null; code: number; text: string | null; isDay: boolean; precipChance: number | null; precipMm: number | null }[];
  days: { date: string; hiC: number | null; loC: number | null; code: number; text: string | null; precipChance: number | null }[];
  /** Epoch ms. */
  fetchedAt: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the upstream JSON is untyped; every read is guarded */
const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const kmhToMs = (v: number | null) => (v == null ? null : Math.round((v / 3.6) * 10) / 10);

/** Google condition type ("SCATTERED_THUNDERSTORMS") → the nearest WMO code, for our icons. */
export function googleTypeToWmo(type: unknown): number {
  const t = typeof type === "string" ? type.toUpperCase() : "";
  if (!t) return 3;
  if (t.includes("THUNDER")) return 95;
  if (t.includes("HAIL")) return 96;
  if (t === "RAIN_AND_SNOW") return 67;
  if (t.includes("SNOW")) return t.includes("HEAVY") || t.includes("STORM") ? 75 : t.includes("LIGHT") ? 71 : t.includes("SHOWER") ? 85 : 73;
  if (t.includes("SHOWER")) return t.includes("HEAVY") ? 82 : t.includes("LIGHT") || t.includes("CHANCE") ? 80 : 81;
  if (t.includes("RAIN")) return t.includes("HEAVY") ? 65 : t.includes("LIGHT") ? 61 : 63;
  if (t.includes("DRIZZLE")) return 53;
  if (t.includes("FOG") || t.includes("HAZE")) return 45;
  if (t === "CLEAR") return 0;
  if (t === "MOSTLY_CLEAR") return 1;
  if (t === "PARTLY_CLOUDY") return 2;
  return 3; // MOSTLY_CLOUDY, CLOUDY, WINDY
}

const text = (cond: any): string | null => (typeof cond?.description?.text === "string" ? cond.description.text : null);
const date = (d: any): string | null =>
  d && num(d.year) && num(d.month) && num(d.day) ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;

export function parseGoogleCurrent(raw: any): GoogleWeather["current"] {
  if (!raw || typeof raw !== "object") return null;
  return {
    tempC: num(raw.temperature?.degrees),
    feelsC: num(raw.feelsLikeTemperature?.degrees),
    text: text(raw.weatherCondition),
    code: googleTypeToWmo(raw.weatherCondition?.type),
    isDay: raw.isDaytime !== false,
    humidity: num(raw.relativeHumidity),
    windMs: kmhToMs(num(raw.wind?.speed?.value)),
    gustMs: kmhToMs(num(raw.wind?.gust?.value)),
    windDeg: num(raw.wind?.direction?.degrees),
    precipChance: num(raw.precipitation?.probability?.percent),
    thunderChance: num(raw.thunderstormProbability),
    uv: num(raw.uvIndex),
  };
}

export function parseGoogleHours(raw: any): GoogleWeather["hours"] {
  const list: any[] = Array.isArray(raw?.forecastHours) ? raw.forecastHours : [];
  return list.flatMap((h) => {
    const time = typeof h?.interval?.startTime === "string" ? h.interval.startTime : null;
    if (!time || !Number.isFinite(Date.parse(time))) return [];
    return [
      {
        time,
        tempC: num(h.temperature?.degrees),
        code: googleTypeToWmo(h.weatherCondition?.type),
        text: text(h.weatherCondition),
        isDay: h.isDaytime !== false,
        precipChance: num(h.precipitation?.probability?.percent),
        precipMm: num(h.precipitation?.qpf?.quantity),
      },
    ];
  });
}

export function parseGoogleDays(raw: any): GoogleWeather["days"] {
  const list: any[] = Array.isArray(raw?.forecastDays) ? raw.forecastDays : [];
  return list.flatMap((d) => {
    const day = date(d?.displayDate);
    if (!day) return [];
    const daytime = d.daytimeForecast ?? {};
    const night = d.nighttimeForecast ?? {};
    const chances = [num(daytime.precipitation?.probability?.percent), num(night.precipitation?.probability?.percent)].filter((v): v is number => v != null);
    return [
      {
        date: day,
        hiC: num(d.maxTemperature?.degrees),
        loC: num(d.minTemperature?.degrees),
        code: googleTypeToWmo(daytime.weatherCondition?.type ?? night.weatherCondition?.type),
        text: text(daytime.weatherCondition) ?? text(night.weatherCondition),
        precipChance: chances.length ? Math.max(...chances) : null,
      },
    ];
  });
}

export function parseGoogleTimeZone(...raws: any[]): string | null {
  for (const r of raws) if (typeof r?.timeZone?.id === "string") return r.timeZone.id;
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
