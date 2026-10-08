"use client";

import type { Feature, FeatureCollection } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { cellSeverity, cellTrack, type CellLevel } from "@/lib/feeds/storm-parse";
import type { StormCell } from "@/lib/feeds/storm-cells";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "storm-cells";

/**
 * Cell colours by `cellSeverity`: TVS magenta (distinct from the red tornado
 * warning polygons it sits inside), mesocyclone orange, severe hail yellow,
 * weak signals pale grey, ordinary cells dark grey.
 */
export const CELL_COLORS: Record<CellLevel, string> = { 4: "#ff2dd4", 3: "#ff9f0a", 2: "#ffd60a", 1: "#c7c7cc", 0: "#8e8e93" };
export const CELL_LEVEL_LABEL: Record<CellLevel, string> = { 4: "Tornado vortex signature", 3: "Mesocyclone", 2: "Severe hail likely", 1: "Hail or weak rotation", 0: "Storm cell" };

const LEVEL = ["get", "level"] as unknown as ExpressionSpecification;
const IS_TRACK: ExpressionSpecification = ["==", ["get", "kind"], "track"];
const IS_CELL: ExpressionSpecification = ["==", ["get", "kind"], "cell"];
/** Ordinary cells only appear once zoomed in; anything with a signal shows at all zooms. */
const VISIBLE: ExpressionSpecification = ["any", [">=", LEVEL, 1], [">=", ["zoom"], 7]];

function cellLabel(c: StormCell, level: CellLevel): string {
  if (c.tvs) return c.tvs;
  if (level === 3) return "MESO";
  if (c.maxHailIn != null && c.maxHailIn >= 0.75) return `${c.maxHailIn.toFixed(c.maxHailIn < 1 ? 2 : 1)}″`;
  return "";
}

/**
 * NEXRAD storm cells (SCIT): a dot per cell coloured by its strongest
 * signature, with the radar's forecast track (15–60 min) as a dashed line and
 * ticks. Tracks only show for cells with a signal, to keep busy days legible.
 */
export function StormCellsLayer({ cells, selectedId, onSelect }: { cells: StormCell[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const data = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    for (const c of cells) {
      const level = cellSeverity(c);
      const color = CELL_COLORS[level];
      const track = level >= 1 || c.id === selectedId ? cellTrack(c) : [];
      if (track.length) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[c.lon, c.lat], ...track.map((p) => [p.lon, p.lat])] },
          properties: { kind: "track", id: c.id, level, color },
        });
        for (const p of track) features.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { kind: "tick", id: c.id, level, color } });
      }
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: { kind: "cell", id: c.id, level, color, label: cellLabel(c, level) },
      });
    }
    // Strongest on top.
    features.sort((a, b) => (a.properties?.level as number) - (b.properties?.level as number));
    return { type: "FeatureCollection", features };
  }, [cells, selectedId]);

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "cell-track",
        type: "line",
        source: SRC,
        filter: ["all", IS_TRACK, VISIBLE],
        layout: { "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.85 },
      },
      {
        id: "cell-tick",
        type: "circle",
        source: SRC,
        filter: ["all", ["==", ["get", "kind"], "tick"], VISIBLE],
        paint: { "circle-radius": 2, "circle-color": ["get", "color"], "circle-stroke-color": "#000000", "circle-stroke-width": 0.5 },
      },
      {
        id: "cell-dot",
        type: "circle",
        source: SRC,
        filter: ["all", IS_CELL, VISIBLE],
        paint: {
          "circle-radius": ["interpolate", ["linear"], LEVEL, 0, 3.5, 4, 7],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#000000",
          "circle-stroke-width": 1.25,
        },
      },
      {
        id: "cell-selected",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 11, "circle-opacity": 0, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      },
      {
        id: "cell-label",
        type: "symbol",
        source: SRC,
        minzoom: 6,
        filter: ["all", IS_CELL, ["!=", ["get", "label"], ""]],
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 10, "text-anchor": "left", "text-offset": [0.9, 0] },
        paint: { "text-color": ["get", "color"], "text-halo-color": "#000000", "text-halo-width": 1.2 },
      },
    ],
    SLOTS.cells,
  );

  const { map } = useMapContext();
  useEffect(() => {
    if (mapAlive(map) && map.getLayer("cell-selected")) map.setFilter("cell-selected", ["all", IS_CELL, ["==", ["get", "id"], selectedId ?? ""]]);
  }, [map, selectedId]);

  useLayerClick(["cell-dot"], (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
