"use client";

import { useEffect, useMemo } from "react";
import { sitesGeoJson } from "@/lib/radar/site-utils";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "radar-sites";

/** WSR-88D sites — click one to switch to its single-site Level-III data. */
export function SitesLayer({ selected, onSelect }: { selected: string | null; onSelect: (icao: string) => void }) {
  const data = useMemo(() => sitesGeoJson(), []);
  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "site-dot",
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 8, 5],
          "circle-color": "#0b0f14",
          "circle-stroke-color": "#94a3b8",
          "circle-stroke-width": 1.4,
        },
      },
      {
        id: "site-selected",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "icao"], ""],
        paint: { "circle-radius": 7, "circle-color": "#f43f5e", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      },
      {
        id: "site-label",
        type: "symbol",
        source: SRC,
        minzoom: 5,
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 10, "text-offset": [0, 1.2], "text-anchor": "top" },
        paint: { "text-color": "#cbd5e1", "text-halo-color": "#000", "text-halo-width": 1.2 },
      },
    ],
    SLOTS.sites,
  );
  const { map } = useMapContext();
  useEffect(() => {
    if (mapAlive(map) && map.getLayer("site-selected")) map.setFilter("site-selected", ["==", ["get", "icao"], selected ?? ""]);
  }, [map, selected]);
  useLayerClick(["site-dot", "site-selected"], (e) => {
    const icao = e.features?.[0]?.properties?.icao;
    if (typeof icao === "string") onSelect(icao);
  });
  return null;
}
