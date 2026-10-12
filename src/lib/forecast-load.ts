import { fetchForecast, type Forecast } from "./api/open-meteo";
import { forecastSource, type ForecastSourceId } from "./forecast-sources";
import { fetchGoogleForecast, GoogleKeyError } from "./google-weather";

/** Whether a forecast has temperatures for the next day (regional models return nulls outside their area). */
function hasData(f: Forecast, nowMs: number): boolean {
  const { time, temp } = f.hourly;
  let count = 0;
  for (let i = 0; i < time.length; i++) {
    const t = time[i]! * 1000;
    if (t >= nowMs && t < nowMs + 24 * 3_600_000 && temp[i] != null) count++;
  }
  return count >= 12;
}

/**
 * The forecast from the chosen source. When that source can't serve this
 * place (a regional model elsewhere, a missing or rejected Google key, a
 * failed request), Open-Meteo's best match is shown instead, with a notice.
 */
export async function loadForecast(lat: number, lon: number, id: ForecastSourceId, googleKey: string, signal?: AbortSignal): Promise<Forecast> {
  const src = forecastSource(id);
  const fallback = async (notice: string) => ({ ...(await fetchForecast(lat, lon, signal)), notice });

  if (src.model) {
    try {
      const f = await fetchForecast(lat, lon, signal, src.model);
      if (hasData(f, Date.now())) return { ...f, source: id };
      return fallback(`${src.label} has no forecast for this location, so this is Open-Meteo's best match.`);
    } catch (err) {
      if (signal?.aborted) throw err;
      return fallback(`Couldn't load ${src.label} right now, so this is Open-Meteo's best match.`);
    }
  }

  const base = await fetchForecast(lat, lon, signal);
  if (id !== "google") return base;
  if (!googleKey) return { ...base, notice: "Add your Google Weather API key to see Google's forecast." };
  try {
    return await fetchGoogleForecast(googleKey, base, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return { ...base, notice: err instanceof GoogleKeyError ? `Google: ${err.message}` : "Couldn't reach Google right now, so this is Open-Meteo's best match." };
  }
}

/** A short hash, so a changed key refetches without the key itself sitting in the query cache. */
export function keyTag(key: string): string {
  if (!key) return "none";
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
