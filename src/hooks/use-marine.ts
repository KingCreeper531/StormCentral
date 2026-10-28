"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/http";
import { fetchWaveGrid } from "@/lib/api/open-meteo-marine";
import type { BuoysResponse } from "@/lib/feeds/buoys";
import type { BBox } from "@/lib/geo";

/** NOAA NDBC buoys and coastal stations for the radar map, while the layer is on. */
export function useBuoys(enabled: boolean) {
  return useQuery({
    queryKey: ["buoys"],
    queryFn: ({ signal }) => getJson<BuoysResponse>("/api/buoys", { signal, timeoutMs: 30_000 }),
    enabled,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}

/**
 * The 48-hour wave forecast over the view (null: off). The sampled area is
 * widened by a quarter on each side and snapped outward to whole degrees, so
 * small pans and zooms reuse the cached grid instead of spending another 120
 * Open-Meteo calls. Wave models run a few times a day: an hour's cache is fresh enough.
 */
export function useWaveGrid(view: BBox | null) {
  const w = view ? (view.east - view.west) * 0.25 : 0;
  const h = view ? (view.north - view.south) * 0.25 : 0;
  const bbox = view && {
    west: Math.floor(view.west - w),
    south: Math.floor(view.south - h),
    east: Math.ceil(view.east + w),
    north: Math.ceil(view.north + h),
  };
  return useQuery({
    queryKey: bbox ? ["waveGrid", bbox.west, bbox.south, bbox.east, bbox.north] : ["waveGrid", "none"],
    queryFn: ({ signal }) => fetchWaveGrid(bbox!, 12, 10, signal),
    enabled: !!bbox,
    staleTime: 60 * 60_000,
    refetchInterval: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}
