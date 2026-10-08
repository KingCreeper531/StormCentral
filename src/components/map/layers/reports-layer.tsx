"use client";

import type { FeatureCollection } from "geojson";
import { useMemo } from "react";
import { CATEGORIES, type PostDto } from "@/lib/community";
import { SLOTS } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "spotter-reports";

/**
 * Community ground-truth reports, sized by severity and faded by age. Recent
 * reports carry a thin ring that fades out over six hours.
 */
export function ReportsLayer({ posts, now, onSelect }: { posts: PostDto[]; now: number; onSelect: (id: string) => void }) {
  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: posts.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          id: p.id,
          color: CATEGORIES[p.category]?.color ?? "#94a3b8",
          severity: p.severity,
          ageMin: Math.max(0, (now - p.createdAt) / 60_000),
          verified: p.verifications,
        },
      })),
    }),
    [posts, now],
  );
  useGeoJsonLayers(
    SRC,
    data,
    () => [
      {
        id: "report-halo",
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": ["+", 9, ["*", 1.5, ["get", "severity"]]],
          "circle-opacity": 0,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 1.25,
          "circle-stroke-opacity": ["interpolate", ["linear"], ["get", "ageMin"], 0, 0.7, 360, 0],
        },
      },
      {
        id: "report-dot",
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": ["+", 4.5, ["get", "severity"]],
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", [">", ["get", "verified"], 0], "#ffffff", "#000000"],
          "circle-stroke-width": 2,
          "circle-opacity": ["interpolate", ["linear"], ["get", "ageMin"], 0, 1, 360, 0.45],
        },
      },
    ],
    SLOTS.reports,
  );
  useLayerClick(["report-dot"], (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
