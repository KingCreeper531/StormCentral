"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import { useMemo, useRef } from "react";
import type { TropicalStorm } from "@/lib/feeds/tropical";
import { intensityColor } from "../../radar/tropical-list";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "tropical";
/** Layers that select a storm, bottom to top. The invisible hit layers widen thin lines and small dots for touch. */
const HIT_LAYERS = ["trop-cone-fill", "trop-line-hit", "trop-point-hit"];

const kind = (k: string): ExpressionSpecification => ["==", ["get", "kind"], k];
const SELECTED: ExpressionSpecification = ["==", ["get", "selected"], 1];
const DIM: ExpressionSpecification = ["==", ["get", "dim"], 1];

/**
 * NHC tropical cyclones: forecast cone (translucent white), past track (solid
 * grey), forecast track (dashed white) and forecast points coloured by
 * intensity, with the current position emphasised. When a storm is
 * selected, the others are dimmed.
 */
export function TropicalLayer({ storms, selectedId, onSelect }: { storms: TropicalStorm[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const data = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    for (const s of storms) {
      const base = { id: s.id, selected: s.id === selectedId ? 1 : 0, dim: selectedId && s.id !== selectedId ? 1 : 0 };
      const add = (geometry: Geometry, props: Record<string, unknown>) => features.push({ type: "Feature", geometry, properties: { ...base, ...props } });
      if (s.cone) add(s.cone, { kind: "cone" });
      if (s.pastTrack) add(s.pastTrack, { kind: "past" });
      if (s.track) add(s.track, { kind: "track" });
      for (const p of s.forecast) {
        // The advisory position is drawn as the current-position marker below.
        if (Math.abs(p.lat - s.lat) < 0.05 && Math.abs(p.lon - s.lon) < 0.05) continue;
        add({ type: "Point", coordinates: [p.lon, p.lat] }, { kind: "point", label: p.label ?? "", color: intensityColor(p.label) });
      }
      add({ type: "Point", coordinates: [s.lon, s.lat] }, { kind: "current", label: s.label ?? "", color: intensityColor(s.label), name: s.name });
    }
    // The selected storm paints over the others.
    features.sort((a, b) => (a.properties?.selected as number) - (b.properties?.selected as number));
    return { type: "FeatureCollection", features };
  }, [storms, selectedId]);

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "trop-cone-fill",
        type: "fill",
        source: SRC,
        filter: kind("cone"),
        paint: { "fill-color": "#ffffff", "fill-opacity": ["case", SELECTED, 0.16, DIM, 0.05, 0.1] },
      },
      {
        id: "trop-cone-line",
        type: "line",
        source: SRC,
        filter: kind("cone"),
        paint: { "line-color": "#ffffff", "line-width": ["case", SELECTED, 1.6, 1], "line-opacity": ["case", SELECTED, 0.95, DIM, 0.3, 0.65] },
      },
      {
        id: "trop-past",
        type: "line",
        source: SRC,
        filter: kind("past"),
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#8b9099", "line-width": ["case", SELECTED, 2.5, 2], "line-opacity": ["case", DIM, 0.4, 1] },
      },
      {
        id: "trop-track",
        type: "line",
        source: SRC,
        filter: kind("track"),
        layout: { "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": ["case", SELECTED, 2, 1.5], "line-dasharray": [2, 2], "line-opacity": ["case", DIM, 0.4, 0.95] },
      },
      {
        id: "trop-line-hit",
        type: "line",
        source: SRC,
        filter: ["any", kind("past"), kind("track")],
        paint: { "line-color": "#000000", "line-width": 16, "line-opacity": 0 },
      },
      {
        id: "trop-points",
        type: "circle",
        source: SRC,
        filter: kind("point"),
        paint: {
          "circle-radius": 4.5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#000000",
          "circle-stroke-width": 1.25,
          "circle-opacity": ["case", DIM, 0.45, 1],
          "circle-stroke-opacity": ["case", DIM, 0.45, 1],
        },
      },
      {
        id: "trop-current-ring",
        type: "circle",
        source: SRC,
        filter: ["all", kind("current"), SELECTED],
        paint: { "circle-radius": 13, "circle-opacity": 0, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 },
      },
      {
        id: "trop-current",
        type: "circle",
        source: SRC,
        filter: kind("current"),
        paint: {
          "circle-radius": 7.5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": ["case", DIM, 0.5, 1],
          "circle-stroke-opacity": ["case", DIM, 0.5, 1],
        },
      },
      {
        id: "trop-point-hit",
        type: "circle",
        source: SRC,
        filter: ["any", kind("point"), kind("current")],
        paint: { "circle-radius": 14, "circle-opacity": 0 },
      },
      {
        id: "trop-labels",
        type: "symbol",
        source: SRC,
        filter: ["all", kind("point"), ["!=", ["get", "label"], ""]],
        minzoom: 4,
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top" },
        paint: { "text-color": "#ececed", "text-halo-color": "#000000", "text-halo-width": 1.2, "text-opacity": ["case", DIM, 0.5, 1] },
      },
      {
        id: "trop-names",
        type: "symbol",
        source: SRC,
        filter: kind("current"),
        layout: {
          // Name at every zoom; the intensity label joins it from zoom 4.
          "text-field": ["step", ["zoom"], ["get", "name"], 4, ["case", ["==", ["get", "label"], ""], ["get", "name"], ["concat", ["get", "name"], " ", ["get", "label"]]]],
          "text-font": font,
          "text-size": 12,
          "text-anchor": "left",
          "text-offset": [1.1, 0],
        },
        paint: { "text-color": "#ececed", "text-halo-color": "#000000", "text-halo-width": 1.4, "text-opacity": ["case", DIM, 0.5, 1] },
      },
    ],
    SLOTS.tropical,
  );

  // One click can hit several layers (a point inside a cone); select once, the top-most storm.
  const { map } = useMapContext();
  const lastEvent = useRef<Event | null>(null);
  useLayerClick(HIT_LAYERS, (e) => {
    if (lastEvent.current === e.originalEvent) return;
    lastEvent.current = e.originalEvent;
    const top = mapAlive(map) ? map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS })[0] : undefined;
    const id = (top ?? e.features?.[0])?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
