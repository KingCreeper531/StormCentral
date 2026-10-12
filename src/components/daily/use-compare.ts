"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/http";
import type { Forecast } from "@/lib/api/open-meteo";
import { compareSource, modelUrl, seriesFromForecast, type CompareSourceId } from "@/lib/compare-sources";
import { fetchGoogleWeather, GoogleKeyError, parseModel, type GoogleWeather } from "@/lib/google-weather";
import { useAppStore } from "@/store/app-store";

export type CompareResult =
  | { kind: "ok"; data: GoogleWeather }
  /** The model has no forecast here (regional models outside their area). */
  | { kind: "none" }
  /** Google picked without a key. */
  | { kind: "no-key" }
  | { kind: "key-error"; message: string };

/** A short hash, so a changed key refetches without the key itself sitting in the query cache. */
function keyTag(key: string) {
  if (!key) return "none";
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function load(id: CompareSourceId, key: string, lat: number, lon: number, signal: AbortSignal): Promise<CompareResult> {
  if (id === "google") {
    if (!key) return { kind: "no-key" };
    try {
      return { kind: "ok", data: await fetchGoogleWeather(key, lat, lon, signal) };
    } catch (err) {
      if (err instanceof GoogleKeyError) return { kind: "key-error", message: err.message };
      throw err;
    }
  }
  const data = parseModel(await getJson(modelUrl(compareSource(id).model!, lat, lon), { signal }), Date.now());
  return data ? { kind: "ok", data } : { kind: "none" };
}

/** One comparison source for the forecast's point. The app's own forecast needs no request. */
export function useCompareSeries(id: CompareSourceId, f: Forecast) {
  const key = useAppStore((s) => (id === "google" ? s.googleKey.trim() : ""));
  const lat = Math.round(f.lat * 10) / 10;
  const lon = Math.round(f.lon * 10) / 10;
  return useQuery<CompareResult>({
    queryKey: ["compare", id, lat, lon, id === "google" ? keyTag(key) : null, id === "app" ? f.fetchedAt : 0],
    queryFn: ({ signal }) => (id === "app" ? { kind: "ok", data: seriesFromForecast(f, Date.now()) } : load(id, key, lat, lon, signal)),
    staleTime: id === "app" ? Infinity : 30 * 60_000,
    // Google's free tier is per key; hourly keeps a heavy user well inside it.
    refetchInterval: id === "app" ? false : 60 * 60_000,
    retry: 1,
  });
}
