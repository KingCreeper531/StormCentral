"use client";

import { useEffect } from "react";
import type { ValueGrid } from "@/lib/api/open-meteo";
import { aqiColorRgb, pm25ToAqi } from "@/lib/science/air";
import { mapAlive, SLOTS, useMapContext } from "../map-view";


/**
 * Model air-quality field drawn as a smooth heatmap: the coarse grid is
 * written 1 px per sample into a canvas and the GPU's bilinear filtering
 * does the interpolation (raster-resampling: linear). Grid rows are spaced
 * in Mercator Y, so the quad drapes without distortion.
 */
export function HeatLayer({ grid, opacity = 0.62, id = "aq-heat" }: { grid: ValueGrid | null; opacity?: number; /** Unique per layer when several are stacked. */ id?: string }) {
  const SRC = id;
  const LYR = `${id}-layer`;
  const { map } = useMapContext();

  useEffect(() => {
    if (!map || !grid) return;
    const canvas = document.createElement("canvas");
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(grid.cols, grid.rows);
    for (let i = 0; i < grid.values.length; i++) {
      const v = grid.values[i]!;
      if (!Number.isFinite(v)) continue;
      const aqi = grid.variable === "pm2_5" ? pm25ToAqi(v) : v;
      const [r, g, b] = aqiColorRgb(aqi);
      img.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    const { west, east, north, south } = grid.bbox;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];
    map.addSource(SRC, { type: "canvas", canvas, coordinates, animate: false });
    map.addLayer(
      { id: LYR, type: "raster", source: SRC, paint: { "raster-opacity": opacity, "raster-resampling": "linear", "raster-fade-duration": 0 } },
      SLOTS.heat,
    );
    // animate:false → MapLibre uploads the canvas once as a static texture.
    return () => {
      if (!mapAlive(map)) return;
      if (map.getLayer(LYR)) map.removeLayer(LYR);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map, grid, opacity, SRC, LYR]);

  return null;
}
