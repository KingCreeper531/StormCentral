"use client";

import type { RasterTileSource } from "maplibre-gl";
import { useEffect } from "react";
import { LIGHTNING_ATTRIBUTION, LIGHTNING_REFRESH_MS, lightningTileUrl } from "@/lib/radar/lightning";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

const SRC = "lightning";
const LYR = "lightning";
const slotNow = () => Math.floor(Date.now() / LIGHTNING_REFRESH_MS);

/** NOAA lightning strike density over the radar, refreshed every 5 minutes. */
export function LightningLayer({ opacity = 0.9 }: { opacity?: number }) {
  const { map } = useMapContext();

  useEffect(() => {
    if (!mapAlive(map)) return;
    map.addSource(SRC, { type: "raster", tiles: [lightningTileUrl(slotNow())], tileSize: 256, maxzoom: 10, attribution: LIGHTNING_ATTRIBUTION });
    // Above the radar, below warning polygons and labels.
    map.addLayer({ id: LYR, type: "raster", source: SRC, paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } }, SLOTS.tropical);
    const id = setInterval(() => {
      const src = map.getSource(SRC) as RasterTileSource | undefined;
      src?.setTiles([lightningTileUrl(slotNow())]);
    }, LIGHTNING_REFRESH_MS);
    return () => {
      clearInterval(id);
      if (!mapAlive(map)) return;
      if (map.getLayer(LYR)) map.removeLayer(LYR);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
    // Opacity changes are applied below without rebuilding the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (mapAlive(map) && map.getLayer(LYR)) map.setPaintProperty(LYR, "raster-opacity", opacity);
  }, [map, opacity]);

  return null;
}
