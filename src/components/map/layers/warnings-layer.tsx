"use client";

import type { FeatureCollection } from "geojson";
import { useEffect, useMemo } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "warnings";

/** NWS storm-based warning polygons, styled with official hazard colours. */
export function WarningsLayer({ alerts, selectedId, onSelect }: { alerts: WeatherAlert[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      // Low rank first so the most dangerous polygons paint on top.
      features: [...alerts]
        .filter((a) => a.geometry)
        .sort((a, b) => a.rank - b.rank)
        .map((a) => ({
          type: "Feature",
          geometry: a.geometry!,
          properties: { id: a.id, color: a.color, emergency: a.tags.some((t) => t.includes("EMERGENCY") || t === "PDS") ? 1 : 0 },
        })),
    }),
    [alerts],
  );

  useGeoJsonLayers(
    SRC,
    data,
    () => [
      { id: "warn-fill", type: "fill", source: SRC, paint: { "fill-color": ["get", "color"], "fill-opacity": 0.13 } },
      {
        id: "warn-casing",
        type: "line",
        source: SRC,
        paint: { "line-color": "#000", "line-width": ["case", ["==", ["get", "emergency"], 1], 6, 4.5], "line-opacity": 0.7 },
      },
      {
        id: "warn-line",
        type: "line",
        source: SRC,
        paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "emergency"], 1], 3.5, 2.2] },
      },
      {
        id: "warn-selected",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 1.5] },
      },
    ],
    SLOTS.warnings,
  );

  const { map } = useMapContext();
  useEffect(() => {
    if (mapAlive(map) && map.getLayer("warn-selected")) map.setFilter("warn-selected", ["==", ["get", "id"], selectedId ?? ""]);
  }, [map, selectedId]);

  useLayerClick(["warn-fill"], (e) => {
    const id = e.features?.at(-1)?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
