import "server-only";
import { HttpError } from "../api/http";
import { cached } from "../feeds/cache";
import { parseGoogleCurrent, parseGoogleDays, parseGoogleHours, parseGoogleTimeZone, type GoogleWeather } from "../google-weather";
import { getDbClient } from "../db/client";

const BASE = "https://weather.googleapis.com/v1";
/** Requests per refresh: current conditions, 24 hours, 10 days. */
const CALLS_PER_LOAD = 3;
/** One fetch per area per hour keeps a busy month inside Google's free tier. */
const TTL_MS = 60 * 60_000;

export const googleWeatherKey = () => process.env.GOOGLE_WEATHER_API_KEY?.trim() || null;

/**
 * Hard stop below the free tier (10,000 calls a month): override with
 * GOOGLE_WEATHER_MONTHLY_CAP. Counted in the database so every serverless
 * instance shares it; without a database, counted per instance.
 */
const monthlyCap = () => {
  const n = Number(process.env.GOOGLE_WEATHER_MONTHLY_CAP);
  return Number.isFinite(n) && n > 0 ? n : 9000;
};

let memory = { month: "", count: 0 };

async function reserve(calls: number): Promise<boolean> {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const client = await getDbClient();
    const r = await client.execute({
      sql: "INSERT INTO api_usage (api, month, count) VALUES ('google-weather', ?, ?) ON CONFLICT(api, month) DO UPDATE SET count = count + excluded.count RETURNING count",
      args: [month, calls],
    });
    const count = Number(r.rows[0]?.count ?? 0);
    return count <= monthlyCap();
  } catch {
    if (memory.month !== month) memory = { month, count: 0 };
    memory.count += calls;
    return memory.count <= monthlyCap();
  }
}

async function call(path: string, params: Record<string, string>, key: string) {
  const url = `${BASE}/${path}?${new URLSearchParams({ ...params, key })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
  if (!res.ok) {
    // Never echo the URL: it carries the key.
    const body = await res.text().catch(() => "");
    console.error(`[google-weather] ${path} HTTP ${res.status}: ${body.slice(0, 300)}`);
    throw new HttpError(`Google Weather answered ${res.status}`, res.status === 403 ? 503 : 502);
  }
  return res.json();
}

/** Current conditions, the next 24 hours and 10 days for a point (snapped to 0.1°). */
export async function loadGoogleWeather(lat: number, lon: number): Promise<GoogleWeather> {
  const key = googleWeatherKey();
  if (!key) throw new HttpError("Google Weather isn't set up on this server", 503);
  const la = Math.round(lat * 10) / 10;
  const lo = Math.round(lon * 10) / 10;
  return cached(`google-weather:${la}:${lo}`, TTL_MS, async () => {
    if (!(await reserve(CALLS_PER_LOAD))) throw new HttpError("This month's free Google Weather allowance is used up", 429);
    const loc = { "location.latitude": String(la), "location.longitude": String(lo) };
    const [current, hours, days] = await Promise.all([
      call("currentConditions:lookup", loc, key),
      call("forecast/hours:lookup", { ...loc, hours: "24", pageSize: "24" }, key),
      call("forecast/days:lookup", { ...loc, days: "10", pageSize: "10" }, key),
    ]);
    return {
      timeZone: parseGoogleTimeZone(current, hours, days),
      current: parseGoogleCurrent(current),
      hours: parseGoogleHours(hours),
      days: parseGoogleDays(days),
      fetchedAt: Date.now(),
    };
  });
}
