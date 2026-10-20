"use client";

import type { GeoJSONSource } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { DRAW_COLORS, shapesToGeoJSON, type Shape } from "@/lib/draw/shapes";
import { mapAlive, useMapContext } from "../map/map-view";

/** An arrowhead pointing up, drawn at 2× with a dark rim; the map turns it to the line's direction. */
function headImage(color: string): ImageData | null {
  const size = 48;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  g.beginPath();
  g.moveTo(24, 4);
  g.lineTo(42, 40);
  g.lineTo(24, 32);
  g.lineTo(6, 40);
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 5;
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.stroke();
  g.fillStyle = color;
  g.fill();
  return g.getImageData(0, 0, size, size);
}

const headId = (color: string) => `draw-head-${color.slice(1)}`;

/**
 * Drawings on the map, above everything else: strokes with a dark casing so
 * they read on any radar colour, arrowheads, and labels. One instance per
 * set of shapes (yours, and the live stream's).
 */
export function DrawingLayer({ shapes, id }: { shapes: readonly Shape[]; id: string }) {
  const { map, font } = useMapContext();
  const src = `draw-${id}`;
  const data = useMemo(() => shapesToGeoJSON(shapes), [shapes]);
  const fontKey = font.join(",");

  useEffect(() => {
    if (!mapAlive(map)) return;
    for (const color of DRAW_COLORS) {
      if (map.hasImage(headId(color))) continue;
      const img = headImage(color);
      if (img) map.addImage(headId(color), img, { pixelRatio: 2 });
    }
    map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const lines = ["==", ["get", "kind"], "line"] as never;
    map.addLayer({ id: `${src}-casing`, type: "line", source: src, filter: lines, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "rgba(0,0,0,0.55)", "line-width": ["+", ["get", "width"], 3] } });
    map.addLayer({ id: `${src}-line`, type: "line", source: src, filter: lines, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["get", "width"] } });
    map.addLayer({
      id: `${src}-head`,
      type: "symbol",
      source: src,
      filter: ["==", ["get", "kind"], "head"],
      layout: {
        "icon-image": ["concat", "draw-head-", ["slice", ["get", "color"], 1]],
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-size": ["case", [">=", ["get", "width"], 6], 1.35, 0.9],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    map.addLayer({
      id: `${src}-text`,
      type: "symbol",
      source: src,
      filter: ["==", ["get", "kind"], "text"],
      layout: {
        "text-field": ["get", "text"],
        "text-font": fontKey.split(","),
        "text-size": ["case", [">=", ["get", "width"], 6], 22, 16],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": ["get", "color"], "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 2 },
    });
    return () => {
      if (!mapAlive(map)) return;
      for (const l of ["casing", "line", "head", "text"]) if (map.getLayer(`${src}-${l}`)) map.removeLayer(`${src}-${l}`);
      if (map.getSource(src)) map.removeSource(src);
    };
  }, [map, src, fontKey]);

  useEffect(() => {
    if (mapAlive(map)) (map.getSource(src) as GeoJSONSource | undefined)?.setData(data);
  }, [map, src, data, fontKey]);

  return null;
}
