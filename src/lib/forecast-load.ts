import { fetchForecast, type Forecast } from "./api/open-meteo";
import { forecastSource, hasForecastData, type ForecastSourceId } from "./forecast-sources";
import { fetchGoogleForecast, GoogleKeyError } from "./google-weather";
import { translator, type Translator } from "./i18n/core";

/**
 * The forecast from the chosen source. When that source can't serve this
 * place (a regional model elsewhere, a missing or rejected Google key, a
 * failed request), Open-Meteo's best match is shown instead, with a notice
 * (in `t`'s language; English when omitted).
 */
export async function loadForecast(
  lat: number,
  lon: number,
  id: ForecastSourceId,
  googleKey: string,
  signal?: AbortSignal,
  t: Translator = translator("en"),
): Promise<Forecast> {
  const src = forecastSource(id);
  const fallback = async (notice: string) => ({ ...(await fetchForecast(lat, lon, signal)), notice });

  if (src.model) {
    try {
      const f = await fetchForecast(lat, lon, signal, src.model);
      if (hasForecastData(f.hourly, Date.now())) return { ...f, source: id };
      return fallback(t("{source} has no forecast for this location, so this is Open-Meteo's best match.", { source: t(src.label) }));
    } catch (err) {
      if (signal?.aborted) throw err;
      return fallback(t("Couldn't load {source} right now, so this is Open-Meteo's best match.", { source: t(src.label) }));
    }
  }

  const base = await fetchForecast(lat, lon, signal);
  if (id !== "google") return base;
  if (!googleKey) return { ...base, notice: t("Add your Google Weather API key to see Google's forecast.") };
  try {
    return await fetchGoogleForecast(googleKey, base, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      ...base,
      notice:
        err instanceof GoogleKeyError
          ? t("Google: {message}", { message: t(err.message) })
          : t("Couldn't reach Google right now, so this is Open-Meteo's best match."),
    };
  }
}

/** A short hash, so a changed key refetches without the key itself sitting in the query cache. */
export function keyTag(key: string): string {
  if (!key) return "none";
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
