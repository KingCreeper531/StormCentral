"use client";

import type { Feature, FeatureCollection } from "geojson";
import type { MapStyleImageMissingEvent } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { waveHour, type WaveGrid } from "@/lib/api/open-meteo-marine";
import { waveRgb } from "@/lib/marine";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";
import { WAVE_ARROW_ICON, WAVE_ARROWS_SRC, waveArrowFeature, waveArrowLayers } from "./marine-style";
import { waveArrowIcon } from "./wave-arrow-icon";

const SRC = "wave-field";
const LYR = "wave-field-layer";

/**
 * The wave forecast for one hour: significant wave height as a smooth colour
 * field over the sea (the coarse grid written 1 px per cell into a canvas,
 * blended by the GPU like the air-quality heat map; land cells stay clear),
 * and an arrow per cell showing which way the waves are heading.
 */
export function WavesLayer({ grid, hour, opacity = 0.6 }: { grid: WaveGrid | null; hour: number; opacity?: number }) {
  const { map } = useMapContext();
  const frame = useMemo(() => (grid?.times.length ? waveHour(grid, hour) : null), [grid, hour]);

  // Rebuilt per hour: the canvas is tiny and MapLibre uploads it once (animate: false).
  useEffect(() => {
    if (!map || !grid || !frame) return;
    const canvas = document.createElement("canvas");
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(grid.cols, grid.rows);
    frame.height.forEach((m, i) => {
      if (Number.isFinite(m)) img.data.set([...waveRgb(m), 255], i * 4);
    });
    ctx.putImageData(img, 0, 0);
    const { west, east, north, south } = grid.bbox;
    map.addSource(SRC, {
      type: "canvas",
      canvas,
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
      animate: false,
    });
    map.addLayer(
      { id: LYR, type: "raster", source: SRC, paint: { "raster-opacity": opacity, "raster-resampling": "linear", "raster-fade-duration": 0 } },
      SLOTS.heat,
    );
    return () => {
      if (!mapAlive(map)) return;
      if (map.getLayer(LYR)) map.removeLayer(LYR);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map, grid, frame, opacity]);

  // Register the arrow before its layer is added (effects run in order), and again after a style reload.
  useEffect(() => {
    if (!mapAlive(map)) return;
    const add = () => {
      if (!mapAlive(map) || map.hasImage(WAVE_ARROW_ICON)) return;
      const img = waveArrowIcon();
      if (img) map.addImage(WAVE_ARROW_ICON, img, { pixelRatio: 2 });
    };
    add();
    const onMissing = (e: MapStyleImageMissingEvent) => {
      if (e.id === WAVE_ARROW_ICON) add();
    };
    map.on("styledata", add);
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styledata", add);
      map.off("styleimagemissing", onMissing);
    };
  }, [map]);

  const arrows = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    if (grid && frame) {
      frame.direction.forEach((deg, i) => {
        if (Number.isFinite(deg) && Number.isFinite(frame.height[i]!)) features.push(waveArrowFeature(grid.lons[i]!, grid.lats[i]!, deg));
      });
    }
    return { type: "FeatureCollection", features };
  }, [grid, frame]);
  useGeoJsonLayers(WAVE_ARROWS_SRC, arrows, waveArrowLayers, SLOTS.radar);

  return null;
}
