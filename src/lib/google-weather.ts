/**
 * Google Weather API (Google Maps Platform), normalised for the app. Each
 * person adds their own API key in Settings, and the browser calls Google
 * directly (Google allows it), so the key stays on their device and every
 * user spends their own free allowance. Also the shared comparison shape for
 * the other forecast models (lib/compare-sources).
 */

export interface GoogleWeather {
  /** "google": Google Weather API (the person's key). "model": an Open-Meteo model. */
  source?: "google" | "model";
  /** Hours between forecast steps. */
  stepHours?: number;
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
  days: { date: string; hiC: number | null; loC: number | null; code: number; text: string | null; precipChance: number | null; precipMm?: number | null }[];
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
/** A WMO code from precipitation and cloud when the model doesn't give one. */
function codeFrom(precipMm: number | null, cloud: number | null, tempC: number | null): number {
  if (precipMm != null && precipMm >= 0.2) {
    const snow = tempC != null && tempC <= 0;
    if (precipMm >= 7.5) return snow ? 75 : 65;
    if (precipMm >= 2.5) return snow ? 73 : 63;
    return snow ? 71 : 61;
  }
  if (cloud == null) return 2;
  return cloud < 20 ? 0 : cloud < 50 ? 1 : cloud < 85 ? 2 : 3;
}

/**
 * Any Open-Meteo single-model response (hourly temperature_2m, precipitation,
 * optional precipitation_probability, weather_code, cloud_cover) → the
 * comparison shape. Hours with no temperature (past the model's range) are dropped.
 */
export function parseModel(raw: any, nowMs: number): GoogleWeather | null {
  const h = raw?.hourly;
  const times: unknown[] = Array.isArray(h?.time) ? h.time : [];
  const offset = num(raw?.utc_offset_seconds) ?? 0;
  const hours: GoogleWeather["hours"] = [];
  times.forEach((t, i) => {
    const sec = num(t);
    const tempC = num(h.temperature_2m?.[i]);
    if (sec == null || tempC == null) return;
    const precipMm = num(h.precipitation?.[i]);
    const code = num(h.weather_code?.[i]) ?? codeFrom(precipMm, num(h.cloud_cover?.[i]), tempC);
    const localHour = new Date((sec + offset) * 1000).getUTCHours();
    hours.push({ time: new Date(sec * 1000).toISOString(), tempC, code, text: null, isDay: localHour >= 6 && localHour < 19, precipChance: num(h.precipitation_probability?.[i]), precipMm });
  });
  if (!hours.length) return null;
  // Days in the place's own time zone.
  const byDay = new Map<string, GoogleWeather["hours"]>();
  for (const x of hours) {
    const day = new Date(Date.parse(x.time) + offset * 1000).toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), x]);
  }
  const today = new Date(nowMs + offset * 1000).toISOString().slice(0, 10);
  const days: GoogleWeather["days"] = [...byDay]
    .filter(([d]) => d >= today)
    .map(([date, list]) => {
      const temps = list.map((x) => x.tempC!).filter((v) => v != null);
      const chances = list.map((x) => x.precipChance).filter((v): v is number => v != null);
      const amounts = list.map((x) => x.precipMm).filter((v): v is number => v != null);
      return {
        date,
        hiC: Math.max(...temps),
        loC: Math.min(...temps),
        code: Math.max(...list.map((x) => x.code)),
        text: null,
        precipChance: chances.length ? Math.max(...chances) : null,
        precipMm: amounts.length ? Math.round(amounts.reduce((a, b) => a + b, 0) * 10) / 10 : null,
      };
    });
  const nowEntry = hours.reduce((best, x) => (Math.abs(Date.parse(x.time) - nowMs) < Math.abs(Date.parse(best.time) - nowMs) ? x : best));
  const stepHours = hours.length > 1 ? Math.max(1, Math.round((Date.parse(hours[1]!.time) - Date.parse(hours[0]!.time)) / 3_600_000)) : 1;
  return {
    source: "model",
    stepHours,
    timeZone: typeof raw?.timezone === "string" ? raw.timezone : null,
    current: { tempC: nowEntry.tempC, feelsC: null, text: null, code: nowEntry.code, isDay: nowEntry.isDay, humidity: null, windMs: null, gustMs: null, windDeg: null, precipChance: null, thunderChance: null, uv: null },
    hours,
    days,
    fetchedAt: nowMs,
  };
}

const GOOGLE = "https://weather.googleapis.com/v1";

/** The key was rejected (invalid, API not enabled, billing, quota): fixable in Settings or Google Cloud. */
export class GoogleKeyError extends Error {}

async function googleCall(path: string, params: Record<string, string>, key: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${GOOGLE}/${path}?${new URLSearchParams({ ...params, key })}`, { signal, headers: { Accept: "application/json" } });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  const message: string = body?.error?.message ?? `Google Weather answered ${res.status}`;
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
    throw new GoogleKeyError(
      res.status === 429
        ? "Your Google key has used up its allowance for now."
        : /not valid|invalid/i.test(message)
          ? "Google says this API key isn't valid."
          : /not been used|disabled|enable/i.test(message)
            ? "Turn on the Weather API for this key's project in Google Cloud."
            : /billing/i.test(message)
              ? "Google needs a billing account on this key's project (the free tier still applies)."
              : /referer|restricted|not authorized/i.test(message)
                ? "This key's restrictions block StormCentral. Allow this website (or no website restriction) for the key."
                : message,
    );
  }
  throw new Error(message);
}

/** Current conditions, the next 24 hours and 10 days from Google, with the person's own key. */
export async function fetchGoogleWeather(key: string, lat: number, lon: number, signal?: AbortSignal): Promise<GoogleWeather> {
  const loc = { "location.latitude": lat.toFixed(2), "location.longitude": lon.toFixed(2) };
  const [current, hours, days] = await Promise.all([
    googleCall("currentConditions:lookup", loc, key, signal),
    googleCall("forecast/hours:lookup", { ...loc, hours: "24", pageSize: "24" }, key, signal),
    googleCall("forecast/days:lookup", { ...loc, days: "10", pageSize: "10" }, key, signal),
  ]);
  return {
    source: "google",
    stepHours: 1,
    timeZone: parseGoogleTimeZone(current, hours, days),
    current: parseGoogleCurrent(current),
    hours: parseGoogleHours(hours),
    days: parseGoogleDays(days),
    fetchedAt: Date.now(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
