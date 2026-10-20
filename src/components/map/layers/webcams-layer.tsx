"use client";

import type { FeatureCollection } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import { useMemo } from "react";
import { WEBCAM_SOURCES, WEBCAM_SOURCE_IDS, type Webcam } from "@/lib/webcams";
import { SLOTS } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "webcams";

/** Marker colour by source (lib/webcams WEBCAM_SOURCES). */
const COLOR = ["match", ["get", "source"], ...WEBCAM_SOURCE_IDS.flatMap((s) => [s, WEBCAM_SOURCES[s].color]), "#9aa0a6"] as unknown as ExpressionSpecification;

/**
 * Live cameras: a small dot per camera, coloured by kind (traffic, wildfire,
 * river, volcano), with its name once zoomed in. Thousands of them, so dots
 * stay tiny at country scale and grow as you zoom.
 */
export function WebcamsLayer({ cams, selectedId, onSelect }: { cams: Webcam[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: cams.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: { id: c.id, source: c.source, name: c.name, selected: c.id === selectedId ? 1 : 0 },
      })),
    }),
    [cams, selectedId],
  );

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "webcam-dot",
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2, 7, 3.5, 11, 6],
          "circle-color": COLOR,
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#ffffff", "#000000"],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 2.5, ["interpolate", ["linear"], ["zoom"], 3, 0.5, 9, 1.5]],
        },
      },
      {
        id: "webcam-label",
        type: "symbol",
        source: SRC,
        minzoom: 10,
        layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 11, "text-anchor": "left", "text-offset": [0.9, 0], "text-max-width": 14, "text-optional": true },
        paint: { "text-color": COLOR, "text-halo-color": "#000000", "text-halo-width": 1.2 },
      },
    ],
    SLOTS.reports,
  );

  useLayerClick(["webcam-dot"], (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
