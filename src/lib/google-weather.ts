/**
 * Google Weather API (Google Maps Platform) as a forecast source. Each person
 * adds their own API key, and the browser calls Google directly (Google
 * allows it), so the key stays on their device and every user spends their
 * own free allowance. Google's current conditions, next 48 hours and 10 days
 * are laid over the Open-Meteo forecast, which keeps filling in what Google
 * doesn't provide (15-minute rain, winds aloft, CAPE).
 */
import type { Forecast } from "./api/open-meteo";

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

/** The fields of one Google reading (current conditions or an hour) in the forecast's units. */
function reading(r: any) {
  const km = num(r?.visibility?.distance);
  return {
    temp: num(r?.temperature?.degrees),
    feelsLike: num(r?.feelsLikeTemperature?.degrees),
    dewPoint: num(r?.dewPoint?.degrees),
    rh: num(r?.relativeHumidity),
    precipProb: num(r?.precipitation?.probability?.percent),
    precip: num(r?.precipitation?.qpf?.quantity),
    code: r?.weatherCondition?.type ? googleTypeToWmo(r.weatherCondition.type) : null,
    pressureMsl: num(r?.airPressure?.meanSeaLevelMillibars),
    cloud: num(r?.cloudCover),
    visibility: km == null ? null : km * 1000,
    wind: kmhToMs(num(r?.wind?.speed?.value)),
    dir: num(r?.wind?.direction?.degrees),
    gust: kmhToMs(num(r?.wind?.gust?.value)),
    uv: num(r?.uvIndex),
    isDay: typeof r?.isDaytime === "boolean" ? (r.isDaytime ? 1 : 0) : null,
  };
}

const dateOf = (d: any): string | null =>
  d && num(d.year) && num(d.month) && num(d.day) ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;

/**
 * Google's forecast laid over an Open-Meteo forecast: every value Google gives
 * replaces the matching hour, day or current reading; the rest stays.
 */
export function applyGoogle(base: Forecast, current: any, hours: any[], days: any[], fetchedAt = Date.now()): Forecast {
  const f: Forecast = structuredClone(base);
  const set = <T extends Record<string, unknown>>(target: T, key: keyof T, v: number | null) => {
    if (v != null) (target as Record<string, unknown>)[key as string] = v;
  };

  const c = reading(current);
  set(f.current, "temp", c.temp);
  set(f.current, "feelsLike", c.feelsLike);
  set(f.current, "rh", c.rh);
  set(f.current, "code", c.code);
  set(f.current, "cloud", c.cloud);
  set(f.current, "pressureMsl", c.pressureMsl);
  set(f.current, "windSpeed", c.wind);
  set(f.current, "windDir", c.dir);
  set(f.current, "windGust", c.gust);
  set(f.current, "isDay", c.isDay);

  const hourIndex = new Map(f.hourly.time.map((t, i) => [t, i]));
  for (const h of hours) {
    const start = Date.parse(h?.interval?.startTime);
    const i = Number.isFinite(start) ? hourIndex.get(Math.round(start / 1000)) : undefined;
    if (i == null) continue;
    const r = reading(h);
    const put = (key: keyof Forecast["hourly"], v: number | null) => {
      const arr = f.hourly[key] as (number | null)[] | undefined;
      if (v != null && key !== "time" && Array.isArray(arr)) arr[i] = v;
    };
    put("temp", r.temp);
    put("feelsLike", r.feelsLike);
    put("dewPoint", r.dewPoint);
    put("rh", r.rh);
    put("precipProb", r.precipProb);
    put("precip", r.precip);
    put("code", r.code);
    put("pressureMsl", r.pressureMsl);
    put("cloud", r.cloud);
    put("visibility", r.visibility);
    put("wind10", r.wind);
    put("dir10", r.dir);
    put("gust10", r.gust);
    put("uv", r.uv);
    put("isDay", r.isDay);
  }

  // Daily rows are the place's local midnights; Google labels days by local date.
  const dayIndex = new Map(f.daily.time.map((t, i) => [new Date((t + f.utcOffsetSeconds) * 1000).toISOString().slice(0, 10), i]));
  for (const d of days) {
    const date = dateOf(d?.displayDate);
    const i = date ? dayIndex.get(date) : undefined;
    if (i == null) continue;
    const day = d.daytimeForecast ?? {};
    const night = d.nighttimeForecast ?? {};
    const put = (key: keyof Forecast["daily"], v: number | null) => {
      const arr = f.daily[key] as (number | null)[] | undefined;
      if (v != null && key !== "time" && Array.isArray(arr)) arr[i] = v;
    };
    put("tMax", num(d.maxTemperature?.degrees));
    put("tMin", num(d.minTemperature?.degrees));
    put("code", day.weatherCondition?.type || night.weatherCondition?.type ? googleTypeToWmo(day.weatherCondition?.type ?? night.weatherCondition?.type) : null);
    const chances = [num(day.precipitation?.probability?.percent), num(night.precipitation?.probability?.percent)].filter((v): v is number => v != null);
    put("precipProbMax", chances.length ? Math.max(...chances) : null);
    const qpf = [num(day.precipitation?.qpf?.quantity), num(night.precipitation?.qpf?.quantity)].filter((v): v is number => v != null);
    put("precipSum", qpf.length ? qpf.reduce((a, b) => a + b, 0) : null);
    put("uvMax", num(day.uvIndex));
    const gusts = [num(day.wind?.gust?.value), num(night.wind?.gust?.value)].filter((v): v is number => v != null);
    put("gustMax", gusts.length ? kmhToMs(Math.max(...gusts)) : null);
  }

  f.fetchedAt = fetchedAt;
  f.source = "google";
  return f;
}

/** Google's current conditions, next 48 hours (two pages) and 10 days over `base`, with the person's own key. */
export async function fetchGoogleForecast(key: string, base: Forecast, signal?: AbortSignal): Promise<Forecast> {
  const loc = { "location.latitude": base.lat.toFixed(3), "location.longitude": base.lon.toFixed(3) };
  const [current, page1, days] = await Promise.all([
    googleCall("currentConditions:lookup", loc, key, signal),
    googleCall("forecast/hours:lookup", { ...loc, hours: "48", pageSize: "24" }, key, signal),
    googleCall("forecast/days:lookup", { ...loc, days: "10", pageSize: "10" }, key, signal),
  ]);
  const hours: any[] = Array.isArray(page1?.forecastHours) ? [...page1.forecastHours] : [];
  if (typeof page1?.nextPageToken === "string" && page1.nextPageToken) {
    const page2 = await googleCall("forecast/hours:lookup", { ...loc, hours: "48", pageSize: "24", pageToken: page1.nextPageToken }, key, signal).catch(() => null);
    if (Array.isArray(page2?.forecastHours)) hours.push(...page2.forecastHours);
  }
  return applyGoogle(base, current, hours, Array.isArray(days?.forecastDays) ? days.forecastDays : []);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
