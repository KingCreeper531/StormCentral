"use client";

import type { Feature, FeatureCollection } from "geojson";
import { useMemo } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { projectTrack } from "@/lib/science/storm-motion";
import { SLOTS } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "storm-tracks";
const MINUTES = [15, 30, 45, 60];

/**
 * Projected storm paths parsed from each warning's machine-readable motion
 * line: a track line plus 15-minute ETA ticks, like a pro radar viewer.
 */
export function TracksLayer({ alerts, now }: { alerts: WeatherAlert[]; now: number }) {
  const data = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    for (const a of alerts) {
      if (!a.motion || a.motion.speedKt < 3) continue;
      if (!["Tornado Warning", "Severe Thunderstorm Warning", "Extreme Wind Warning", "Snow Squall Warning"].includes(a.event)) continue;
      const steps = projectTrack(a.motion, [0, ...MINUTES]);
      a.motion.positions.forEach((_, pi) => {
        const line = steps.map((s) => [s.points[pi]!.lon, s.points[pi]!.lat]);
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { color: a.color } });
        steps.slice(1).forEach((s) =>
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [s.points[pi]!.lon, s.points[pi]!.lat] },
            properties: { color: a.color, label: `${s.minutes}′` },
          }),
        );
      });
    }
    return { type: "FeatureCollection", features };
    // `now` re-projects positions as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, now]);

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "track-line",
        type: "line",
        source: SRC,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [3, 2], "line-opacity": 0.9 },
      },
      {
        id: "track-ticks",
        type: "circle",
        source: SRC,
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 3.5, "circle-color": "#000", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 1.5 },
      },
      {
        id: "track-labels",
        type: "symbol",
        source: SRC,
        filter: ["==", ["geometry-type"], "Point"],
        minzoom: 7,
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 10, "text-offset": [0, 1.1], "text-allow-overlap": false },
        paint: { "text-color": "#e5e7eb", "text-halo-color": "#000", "text-halo-width": 1.2 },
      },
    ],
    SLOTS.tracks,
  );
  return null;
}
