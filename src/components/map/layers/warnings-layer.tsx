"use client";

import type { FeatureCollection } from "geojson";
import { useEffect, useMemo } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "warnings";

/**
 * How a polygon is drawn: storm-based warnings bold with a dark casing;
 * zone/county products (watches, advisories, other countries' warnings) as a
 * light wash with a thin edge; SPC/WPC discussions and watch boxes as dashed
 * outlines; the spotter network's unofficial warnings dashed and labelled
 * "SPOTTER" so they can't be mistaken for the NWS's.
 */
type Look = "storm" | "area" | "outline" | "spotter";
const lookOf = (a: WeatherAlert): Look =>
  a.source === "spotter" ? "spotter" : a.category === "discussion" || (a.source === "spc" && a.area === false) ? "outline" : a.area ? "area" : "storm";
const LAYER_ORDER: Record<Look, number> = { area: 0, outline: 0, spotter: 1, storm: 2 };
const SPOTTER_SHORT: Record<string, string> = {
  "Spotter Tornado Warning": "TOR",
  "Spotter Severe Thunderstorm Warning": "SVR",
  "Spotter Flash Flood Warning": "FFW",
  "Spotter Snow Squall Warning": "SQW",
  "Spotter Significant Weather Advisory": "SWA",
};

/** Hazard polygons styled with official hazard colours (NWS storm-based warnings plus everything on the hazard map). */
export function WarningsLayer({ alerts, selectedId, onSelect }: { alerts: WeatherAlert[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      // Areas under storm warnings, then low rank first, so the most dangerous polygons paint on top.
      features: alerts
        .filter((a) => a.geometry)
        .map((a) => ({ a, look: lookOf(a) }))
        .sort((x, y) => LAYER_ORDER[x.look] - LAYER_ORDER[y.look] || x.a.rank - y.a.rank)
        .map(({ a, look }) => ({
          type: "Feature",
          geometry: a.geometry!,
          properties: {
            id: a.id,
            color: a.color,
            look,
            emergency: a.tags.some((t) => t.includes("EMERGENCY") || t === "PDS") ? 1 : 0,
            label: look === "spotter" ? `SPOTTER ${SPOTTER_SHORT[a.event] ?? ""}`.trim() : "",
          },
        })),
    }),
    [alerts],
  );

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "warn-fill",
        type: "fill",
        source: SRC,
        paint: { "fill-color": ["get", "color"], "fill-opacity": ["match", ["get", "look"], "storm", 0.13, "area", 0.09, "spotter", 0.08, 0] },
      },
      {
        id: "warn-casing",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "look"], "storm"],
        paint: { "line-color": "#000", "line-width": ["case", ["==", ["get", "emergency"], 1], 6, 4.5], "line-opacity": 0.7 },
      },
      {
        id: "warn-line",
        type: "line",
        source: SRC,
        filter: ["match", ["get", "look"], ["storm", "area"], true, false],
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["match", ["get", "look"], "storm", ["case", ["==", ["get", "emergency"], 1], 3.5, 2.2], 1.1],
          "line-opacity": ["match", ["get", "look"], "storm", 1, 0.85],
        },
      },
      {
        id: "warn-outline",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "look"], "outline"],
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2] },
      },
      {
        id: "warn-spotter-casing",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "look"], "spotter"],
        paint: { "line-color": "#000", "line-width": 4.5, "line-opacity": 0.55 },
      },
      {
        id: "warn-spotter",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "look"], "spotter"],
        paint: { "line-color": ["get", "color"], "line-width": 2.6, "line-dasharray": [2, 1.2] },
      },
      {
        id: "warn-spotter-label",
        type: "symbol",
        source: SRC,
        filter: ["==", ["get", "look"], "spotter"],
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 11, "text-letter-spacing": 0.08, "text-allow-overlap": false },
        paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1.5 },
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
    // MapLibre lists the topmost feature first: a storm-based warning wins over the watch or advisory under it.
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
