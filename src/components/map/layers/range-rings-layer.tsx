"use client";

import { useMemo } from "react";
import type { LatLon } from "@/lib/geo";
import { rangeRings } from "@/lib/range-rings";
import type { DistanceUnit } from "@/lib/weather/units";
import { SLOTS, useMapContext } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "range-rings";
const kind = (k: string) => ["==", ["get", "kind"], k] as never;

/**
 * Range rings (lib/range-rings): thin geodesic circles every `step` of the
 * distance unit around `center` (the radar site, or the location), the
 * distance on each, and optional bearing spokes every 30°. Above the
 * basemap's labels like the storm paths, but never hiding them.
 */
export function RangeRingsLayer({ center, step, unit, spokes }: { center: LatLon; step: number; unit: DistanceUnit; spokes: boolean }) {
  // White reads on the dark basemap; the light ones need near-black (switching basemap builds a new map, re-adding these).
  const { dark } = useMapContext();
  const fg = dark ? "#ffffff" : "#111316";
  const halo = dark ? "#000000" : "#ffffff";
  const { lat, lon } = center;
  const data = useMemo(() => rangeRings({ lat, lon }, step, unit, spokes), [lat, lon, step, unit, spokes]);

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "ring-line",
        type: "line",
        source: SRC,
        filter: kind("ring"),
        paint: { "line-color": fg, "line-width": 1, "line-opacity": 0.55 },
      },
      {
        id: "ring-spoke",
        type: "line",
        source: SRC,
        filter: kind("spoke"),
        paint: { "line-color": fg, "line-width": 0.75, "line-opacity": 0.35, "line-dasharray": [4, 3] },
      },
      {
        id: "ring-label",
        type: "symbol",
        source: SRC,
        filter: ["match", ["get", "kind"], ["label", "spoke-label"], true, false],
        layout: {
          "text-field": ["get", "label"],
          "text-font": font,
          "text-size": 10,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": fg, "text-opacity": 0.85, "text-halo-color": halo, "text-halo-width": 1.2 },
      },
    ],
    SLOTS.tracks,
  );
  return null;
}
