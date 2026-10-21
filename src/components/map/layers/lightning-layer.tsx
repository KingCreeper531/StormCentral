"use client";

import type { FeatureCollection } from "geojson";
import type { Map as MlMap, RasterTileSource } from "maplibre-gl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { getJson } from "@/lib/api/http";
import { boltsFromFile, flashesBbox, flashesUrl, LIGHTNING_ATTRIBUTION, LIGHTNING_REFRESH_MS, lightningTileUrl, type Bbox, type LightningFile } from "@/lib/radar/lightning";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "lightning";
const ICON = "lightning-bolt";
const DENSITY_SRC = "lightning-density";
const slotNow = () => Math.floor(Date.now() / LIGHTNING_REFRESH_MS);

/** The lightning bolt: plain white with a black outline, drawn at 2× so it stays crisp. */
function boltImage(): ImageData | null {
  const ratio = 2;
  // Room for the outline around the 14×20 bolt.
  const pad = 1.5;
  const w = (14 + 2 * pad) * ratio;
  const h = (20 + 2 * pad) * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const pts: [number, number][] = [[8.5, 1], [2, 11.5], [6.5, 11.5], [4.5, 19], [12, 7.5], [7.5, 7.5], [10, 1]];
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo((x + pad) * ratio, (y + pad) * ratio) : g.moveTo((x + pad) * ratio, (y + pad) * ratio)));
  g.closePath();
  g.lineJoin = "round";
  // Stroked under the fill, so 1.5 px of the 3 px line shows outside it.
  g.lineWidth = 3 * ratio;
  g.strokeStyle = "#000";
  g.stroke();
  g.fillStyle = "#fff";
  g.fill();
  return g.getImageData(0, 0, w, h);
}

/** The area of flashes to ask for: the map's view, widened to whole 10° squares, updated as it moves. */
function useFlashesBbox(map: MlMap | null): Bbox | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    if (!mapAlive(map)) return;
    const update = () => {
      const b = map.getBounds();
      setKey(flashesBbox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()).join(","));
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map]);
  return useMemo(() => (key ? (key.split(",").map(Number) as unknown as Bbox) : null), [key]);
}

/** GOES GLM flashes in the area, from the app's server (NOAA open data). */
function useGlmFlashes(bbox: Bbox | null) {
  return useQuery({
    queryKey: ["lightning-flashes", bbox?.join(",")],
    queryFn: ({ signal }) => getJson<LightningFile>(flashesUrl(bbox!), { signal, timeoutMs: 20_000 }),
    enabled: !!bbox,
    // The bolts already shown stay while a moved map's area loads.
    placeholderData: keepPreviousData,
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
 * Lightning: a plain white bolt with a black outline for each GOES GLM flash
 * of the last 15 minutes (dense storms thin out: bolts don't overlap, the
 * newest win). If the flashes can't be had, NOAA nowCOAST's strike-density
 * squares instead.
 */
export function LightningLayer({ opacity = 1 }: { opacity?: number }) {
  const { map } = useMapContext();
  const glm = useGlmFlashes(useFlashesBbox(map));
  const useDensity = glm.isError;
  // Ages tick on between fetches, so bolts leave the 15 minutes on time.
  const now = useNow(30_000);

  // Register the bolt before the layers below are added (effects run in order).
  useEffect(() => {
    if (!mapAlive(map) || map.hasImage(ICON)) return;
    const img = boltImage();
    if (img) map.addImage(ICON, img, { pixelRatio: 2 });
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
          "icon-image": ICON,
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
