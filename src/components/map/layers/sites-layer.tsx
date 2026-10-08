"use client";

import { useEffect, useMemo } from "react";
import { sitesGeoJson } from "@/lib/radar/site-utils";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "radar-sites";
const SELECTED_ICON = "site-selected-square";

/**
 * The selected site: a 13 px accent square with a white edge and a 1 px dark
 * rim, drawn at 2× for crisp edges. Square, so it can't be confused with the
 * round "you are here" marker or a report dot.
 */
function selectedSquare(): ImageData | null {
  const ratio = 2;
  const size = 13 * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const rect = (inset: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(inset * ratio, inset * ratio, size - 2 * inset * ratio, size - 2 * inset * ratio);
  };
  rect(0, "rgba(0,0,0,0.7)");
  rect(1, "#ffffff");
  rect(3, "#5b9cf6"); // --color-accent: selection uses the single interactive accent.
  return g.getImageData(0, 0, size, size);
}

/** WSR-88D sites — click one to switch to its single-site Level-III data. */
export function SitesLayer({ selected, onSelect }: { selected: string | null; onSelect: (icao: string) => void }) {
  const data = useMemo(() => sitesGeoJson(), []);
  const { map } = useMapContext();
  // Register the icon before the layers below are added (effects run in order).
  useEffect(() => {
    if (!mapAlive(map) || map.hasImage(SELECTED_ICON)) return;
    const img = selectedSquare();
    if (img) map.addImage(SELECTED_ICON, img, { pixelRatio: 2 });
  }, [map]);
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
          "circle-color": "#0e0f11", // surface-1
          "circle-stroke-color": "#a8acb3", // ink-2
          "circle-stroke-width": 1.25,
        },
      },
      {
        id: "site-selected",
        type: "symbol",
        source: SRC,
        filter: ["==", ["get", "icao"], ""],
        layout: { "icon-image": SELECTED_ICON, "icon-allow-overlap": true, "icon-ignore-placement": true },
      },
      {
        id: "site-label",
        type: "symbol",
        source: SRC,
        minzoom: 5,
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 10, "text-offset": [0, 1.2], "text-anchor": "top" },
        paint: { "text-color": "#a8acb3", "text-halo-color": "#000", "text-halo-width": 1.2 },
      },
    ],
    SLOTS.sites,
  );
  useEffect(() => {
    if (mapAlive(map) && map.getLayer("site-selected")) map.setFilter("site-selected", ["==", ["get", "icao"], selected ?? ""]);
  }, [map, selected]);
  useLayerClick(["site-dot", "site-selected"], (e) => {
    const icao = e.features?.[0]?.properties?.icao;
    if (typeof icao === "string") onSelect(icao);
  });
  return null;
}
