"use client";

import type { RasterTileSource } from "maplibre-gl";
import { useEffect } from "react";
import { SNOW_REFRESH_MS, snowSource, snowTileUrl, type SnowMap, type SnowThreshold } from "@/lib/radar/snow";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

const SRC = "snow";
const slotNow = () => Math.floor(Date.now() / SNOW_REFRESH_MS);

/**
 * Snow from NOAA's map services, in their own colours: WPC's chance of
 * snowfall for Day 1–3, or NOHRSC's snow depth now. Drawn under the radar,
 * so storms and warnings stay on top, and refreshed as the services update.
 */
export function SnowLayer({ map: kind, threshold, opacity = 0.7 }: { map: SnowMap; threshold: SnowThreshold; opacity?: number }) {
  const { map } = useMapContext();
  const src = snowSource(kind, threshold);
  const tiles = src ? snowTileUrl(src, 0) : null;

  useEffect(() => {
    if (!mapAlive(map) || !src) return;
    map.addSource(SRC, { type: "raster", tiles: [snowTileUrl(src, slotNow())], tileSize: 256, maxzoom: src.maxzoom, attribution: src.attribution });
    // Above the satellite and outlook, under the radar.
    map.addLayer({ id: SRC, type: "raster", source: SRC, paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } }, SLOTS.radar);
    const id = setInterval(() => (map.getSource(SRC) as RasterTileSource | undefined)?.setTiles([snowTileUrl(src, slotNow())]), SNOW_REFRESH_MS);
    return () => {
      clearInterval(id);
      if (!mapAlive(map)) return;
      if (map.getLayer(SRC)) map.removeLayer(SRC);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
    // Rebuilt when the picture changes (`tiles` stands for `src`); opacity is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tiles]);

  useEffect(() => {
    if (mapAlive(map) && map.getLayer(SRC)) map.setPaintProperty(SRC, "raster-opacity", opacity);
  }, [map, opacity]);

  return null;
}
