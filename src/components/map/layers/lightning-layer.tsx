"use client";

import type { FeatureCollection } from "geojson";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { PRO_SERVER } from "@/lib/pro/server";
import {
  BOLT_AGES,
  BOLT_COLORS,
  boltsFromDensity,
  boltsFromFile,
  LIGHTNING_REFRESH_MS,
  lightningImageUrl,
  type Bolt,
  type LightningFile,
} from "@/lib/radar/lightning";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "lightning";
const ICONS = BOLT_COLORS.map((_, i) => `lightning-bolt-${i}`);
/** Screen pixels per density-grid bolt (the grid itself is about 8 km). */
const DENSITY_CELL_PX = 22;

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
 * Bolts on the density grid for the map's view (no Pro data server): one
 * GetMap of the view, sampled into cells. Refreshed as the view settles and
 * as nowCOAST updates.
 */
function useDensityBolts(enabled: boolean): Bolt[] {
  const { map } = useMapContext();
  const [bolts, setBolts] = useState<Bolt[]>([]);
  useEffect(() => {
    if (!enabled || !mapAlive(map)) return;
    let ac: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      ac?.abort();
      const ctl = (ac = new AbortController());
      const b = map.getBounds();
      const merc = (lon: number, lat: number) => {
        const x = (lon * 20037508.342789244) / 180;
        const y = (Math.log(Math.tan(((90 + Math.max(-85, Math.min(85, lat))) * Math.PI) / 360)) / Math.PI) * 20037508.342789244;
        return [x, y] as const;
      };
      const [minX, minY] = merc(b.getWest(), b.getSouth());
      const [maxX, maxY] = merc(b.getEast(), b.getNorth());
      const el = map.getContainer();
      // A quarter of the screen's pixels is plenty for an 8 km grid.
      const width = Math.max(16, Math.min(1024, Math.round(el.clientWidth / 4)));
      const height = Math.max(16, Math.min(1024, Math.round(el.clientHeight / 4)));
      try {
        const res = await fetch(lightningImageUrl([minX, minY, maxX, maxY], width, height, Math.floor(Date.now() / LIGHTNING_REFRESH_MS)), { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const bmp = await createImageBitmap(await res.blob());
        const canvas = new OffscreenCanvas(width, height);
        const g = canvas.getContext("2d");
        if (!g) return;
        g.drawImage(bmp, 0, 0, width, height);
        const { data } = g.getImageData(0, 0, width, height);
        if (!ctl.signal.aborted) setBolts(boltsFromDensity(data, width, height, [minX, minY, maxX, maxY], Math.max(2, Math.round(DENSITY_CELL_PX / 4))));
      } catch {
        // Leave the last bolts up; the next settle or refresh tries again.
      }
    };
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    settle();
    map.on("moveend", settle);
    const id = setInterval(load, LIGHTNING_REFRESH_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(id);
      ac?.abort();
      if (mapAlive(map)) map.off("moveend", settle);
    };
  }, [map, enabled]);
  return enabled ? bolts : [];
}

/**
 * Lightning as bolts: each GOES GLM flash of the last 15 minutes from the Pro
 * data server, white when new, then yellow, orange and red as it ages; or,
 * without a server, a bolt on each cell of NOAA nowCOAST's strike-density
 * grid. Dense storms thin out (bolts don't overlap; the newest win).
 */
export function LightningLayer({ opacity = 1 }: { opacity?: number }) {
  const { map } = useMapContext();
  const glm = useGlmFlashes();
  const useDensity = !PRO_SERVER || glm.isError;
  const density = useDensityBolts(useDensity);
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
    const bolts = useDensity ? density : glm.data ? boltsFromFile(glm.data, now) : [];
    return {
      type: "FeatureCollection",
      features: bolts.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: { age: b.age } })),
    };
  }, [useDensity, density, glm.data, now]);

  useGeoJsonLayers(
    SRC,
    data,
    () => [
      {
        id: "lightning-bolts",
        type: "symbol",
        source: SRC,
        layout: {
          // Density-grid bolts (age -1) don't know their age: yellow, between new and old.
          "icon-image": ["step", ["get", "age"], ICONS[1]!, 0, ICONS[0]!, BOLT_AGES[0], ICONS[1]!, BOLT_AGES[1], ICONS[2]!, BOLT_AGES[2], ICONS[3]!],
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

  return null;
}
