"use client";

import type { FeatureCollection } from "geojson";
import { useMemo } from "react";
import type { Buoy } from "@/lib/feeds/buoys";
import { SLOTS } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";
import { BUOY_SELECTED_SRC, buoyFeature, buoyLayers, BUOYS_SRC, buoySelectedLayers } from "./marine-style";

/**
 * NOAA NDBC buoys and coastal stations: a dot per station coloured by its
 * latest significant wave height (grey where it measures none). The open
 * station is ringed in white.
 */
export function BuoysLayer({ buoys, selectedId, onSelect }: { buoys: Buoy[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const data = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features: buoys.map(buoyFeature) }), [buoys]);
  const selected = useMemo<FeatureCollection>(() => {
    const b = selectedId ? buoys.find((x) => x.id === selectedId) : undefined;
    return { type: "FeatureCollection", features: b ? [buoyFeature(b)] : [] };
  }, [buoys, selectedId]);

  useGeoJsonLayers(BUOYS_SRC, data, buoyLayers, SLOTS.stormReports);
  useGeoJsonLayers(BUOY_SELECTED_SRC, selected, buoySelectedLayers, SLOTS.stormReports);

  useLayerClick(["buoy-dot", "buoy-selected-dot"], (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
