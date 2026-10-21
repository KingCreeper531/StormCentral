"use client";

import type { FeatureCollection } from "geojson";
import type { RasterTileSource } from "maplibre-gl";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useNow } from "@/hooks/use-now";
import { PRO_SERVER } from "@/lib/pro/server";
import { BOLT_AGES, BOLT_COLORS, boltsFromFile, LIGHTNING_ATTRIBUTION, LIGHTNING_REFRESH_MS, lightningTileUrl, type LightningFile } from "@/lib/radar/lightning";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "lightning";
const ICONS = BOLT_COLORS.map((_, i) => `lightning-bolt-${i}`);
const DENSITY_SRC = "lightning-density";
const slotNow = () => Math.floor(Date.now() / LIGHTNING_REFRESH_MS);

/** A lightning bolt, drawn at 2× with a dark rim so it reads over any radar colour. */
function boltImage(color: string): ImageData | null {
  const ratio = 2;
  const w = 14 * ratio;
  const h = 20 * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const pts: [number, number][] = [[8.5, 1], [2, 11.5], [6.5, 11.5], [4.5, 19], [12, 7.5], [7.5, 7.5], [10, 1]];
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * ratio, y * ratio) : g.moveTo(x * ratio, y * ratio)));
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 2.5 * ratio;
  g.strokeStyle = "rgba(0,0,0,0.8)";
  g.stroke();
  g.fillStyle = color;
  g.fill();
  return g.getImageData(0, 0, w, h);
}

/** GOES GLM flashes from the Pro data server; null when there's no server or it can't be reached. */
function useGlmFlashes() {
  return useQuery({
    queryKey: ["lightning", PRO_SERVER],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${PRO_SERVER}/lightning.json`, { signal, cache: "no-cache" });
      if (!res.ok) throw new Error(`lightning.json: ${res.status}`);
      return (await res.json()) as LightningFile;
    },
    enabled: !!PRO_SERVER,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * NOAA nowCOAST's strike-density grid as it is: the ~8 km squares with
 * lightning in the last 15 minutes, in nowCOAST's colours, refreshed as it
 * updates. It doesn't say where in a square the strikes were, so it isn't
 * turned into bolts.
 */
function DensityGrid({ opacity }: { opacity: number }) {
  const { map } = useMapContext();

  useEffect(() => {
    if (!mapAlive(map)) return;
    map.addSource(DENSITY_SRC, { type: "raster", tiles: [lightningTileUrl(slotNow())], tileSize: 256, maxzoom: 10, attribution: LIGHTNING_ATTRIBUTION });
    // Above the radar, below warning polygons and labels.
    map.addLayer({ id: DENSITY_SRC, type: "raster", source: DENSITY_SRC, paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } }, SLOTS.tropical);
    const id = setInterval(() => (map.getSource(DENSITY_SRC) as RasterTileSource | undefined)?.setTiles([lightningTileUrl(slotNow())]), LIGHTNING_REFRESH_MS);
    return () => {
      clearInterval(id);
      if (!mapAlive(map)) return;
      if (map.getLayer(DENSITY_SRC)) map.removeLayer(DENSITY_SRC);
      if (map.getSource(DENSITY_SRC)) map.removeSource(DENSITY_SRC);
    };
    // Opacity changes are applied below without rebuilding the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (mapAlive(map) && map.getLayer(DENSITY_SRC)) map.setPaintProperty(DENSITY_SRC, "raster-opacity", opacity);
  }, [map, opacity]);

  return null;
}

/**
 * Lightning: a bolt for each GOES GLM flash of the last 15 minutes from the
 * Pro data server, white when new, then yellow, orange and red as it ages
 * (dense storms thin out: bolts don't overlap, the newest win). Without a
 * server, NOAA nowCOAST's strike-density squares.
 */
export function LightningLayer({ opacity = 1 }: { opacity?: number }) {
  const { map } = useMapContext();
  const glm = useGlmFlashes();
  const useDensity = !PRO_SERVER || glm.isError;
  // Ages tick on between fetches.
  const now = useNow(30_000);

  // Register the bolts before the layers below are added (effects run in order).
  useEffect(() => {
    if (!mapAlive(map)) return;
    ICONS.forEach((id, i) => {
      if (map.hasImage(id)) return;
      const img = boltImage(BOLT_COLORS[i]!);
      if (img) map.addImage(id, img, { pixelRatio: 2 });
    });
  }, [map]);

  const data = useMemo<FeatureCollection>(() => {
    const bolts = !useDensity && glm.data ? boltsFromFile(glm.data, now) : [];
    return {
      type: "FeatureCollection",
      features: bolts.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: { age: b.age } })),
    };
  }, [useDensity, glm.data, now]);

  useGeoJsonLayers(
    SRC,
    data,
    () => [
      {
        id: "lightning-bolts",
        type: "symbol",
        source: SRC,
        layout: {
          "icon-image": ["step", ["get", "age"], ICONS[0]!, BOLT_AGES[0], ICONS[1]!, BOLT_AGES[1], ICONS[2]!, BOLT_AGES[2], ICONS[3]!],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 6, 0.75, 10, 1],
          // Newest first, so they win where bolts would overlap.
          "symbol-sort-key": ["get", "age"],
          "icon-allow-overlap": false,
          "icon-padding": 0,
        },
        paint: { "icon-opacity": opacity },
      },
    ],
    // Above the radar, below warning polygons and labels.
    SLOTS.tropical,
  );

  useEffect(() => {
    if (mapAlive(map) && map.getLayer("lightning-bolts")) map.setPaintProperty("lightning-bolts", "icon-opacity", opacity);
  }, [map, opacity]);

  return useDensity ? <DensityGrid opacity={opacity} /> : null;
}
