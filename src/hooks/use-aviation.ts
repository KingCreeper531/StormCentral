"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/http";
import { snapToTiles, type AirportResponse, type AviationAdvisoriesResponse, type AviationMetarsResponse } from "@/lib/aviation";
import type { BBox } from "@/lib/geo";

/**
 * Aviation weather for the radar map (lib/aviation), while the layer is on.
 * METARs come in every few minutes, so the airports poll every 5; the open
 * airport's card loads its own METAR and TAF.
 */

/**
 * Airports in view, by whole 10° tiles (so panning within them refetches
 * nothing, and everyone viewing an area shares the cached tiles). A view
 * wider than loads at once fetches nothing and keeps the airports from before.
 */
export function useAviationMetars(bbox: BBox | null, enabled: boolean) {
  const box = bbox ? snapToTiles(bbox) : null;
  const key = box?.join(",") ?? null;
  return useQuery({
    queryKey: ["aviation", "metars", key],
    queryFn: ({ signal }) => getJson<AviationMetarsResponse>(`/api/aviation/metars?bbox=${key}`, { signal, timeoutMs: 30_000 }),
    enabled: enabled && !!key,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** One airport's latest METAR and TAF, for its card. */
export function useAirport(id: string | null) {
  return useQuery({
    queryKey: ["aviation", "airport", id],
    queryFn: ({ signal }) => getJson<AirportResponse>(`/api/aviation/airport?id=${encodeURIComponent(id!)}`, { signal }),
    enabled: !!id,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** SIGMETs, convective SIGMETs and (G-)AIRMETs over the US. */
export function useAviationAdvisories(enabled: boolean) {
  return useQuery({
    queryKey: ["aviation", "advisories"],
    queryFn: ({ signal }) => getJson<AviationAdvisoriesResponse>("/api/aviation/advisories", { signal, timeoutMs: 30_000 }),
    enabled,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
