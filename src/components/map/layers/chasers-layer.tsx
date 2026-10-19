"use client";

import type { FeatureCollection } from "geojson";
import type { MapStyleImageMissingEvent } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { CHASER_STALE_MS, type ChaserDto } from "@/lib/chasers";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "storm-chasers";
/** Teal for other chasers (no other overlay uses it); the accent blue for me. */
export const CHASER_COLOR = "#2dd4bf";
export const MY_CHASER_COLOR = "#5b9cf6";
const ARROWS = { "chaser-arrow": CHASER_COLOR, "chaser-arrow-mine": MY_CHASER_COLOR } as const;

/** A navigation arrow pointing up (north), drawn at 2× with a dark rim, rotated on the map by heading. */
function arrowImage(color: string): ImageData | null {
  const ratio = 2;
  const size = 22 * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const c = size / 2;
  const path = () => {
    g.beginPath();
    g.moveTo(c, 2 * ratio);
    g.lineTo(size - 4 * ratio, size - 3 * ratio);
    g.lineTo(c, size - 7 * ratio);
    g.lineTo(4 * ratio, size - 3 * ratio);
    g.closePath();
  };
  path();
  g.lineJoin = "round";
  g.lineWidth = 3 * ratio;
  g.strokeStyle = "rgba(0,0,0,0.75)";
  g.stroke();
  g.fillStyle = color;
  g.fill();
  return g.getImageData(0, 0, size, size);
}

/**
 * Storm chasers sharing their live position: an arrow pointing where they're
 * heading (a dot when parked or unknown) with their username once zoomed in.
 * Markers fade after 5 minutes without an update; the server drops them
 * after 15.
 */
export function ChasersLayer({ chasers, fetchedAt, now, onSelect }: { chasers: ChaserDto[]; fetchedAt: number; now: number; onSelect: (username: string) => void }) {
  const { map } = useMapContext();

  // Register the arrows before the layers below are added (effects run in order).
  useEffect(() => {
    if (!mapAlive(map)) return;
    const add = () => {
      for (const [id, color] of Object.entries(ARROWS)) {
        if (!mapAlive(map) || map.hasImage(id)) continue;
        const img = arrowImage(color);
        if (img) map.addImage(id, img, { pixelRatio: 2 });
      }
    };
    add();
    // A style reload drops runtime images: put them back once the new style is in.
    const onMissing = (e: MapStyleImageMissingEvent) => {
      if (e.id in ARROWS) add();
    };
    map.on("styledata", add);
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styledata", add);
      map.off("styleimagemissing", onMissing);
    };
  }, [map]);

  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      // Mine last, so it draws on top.
      features: [...chasers]
        .sort((a, b) => Number(a.mine) - Number(b.mine))
        .map((c) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [c.lon, c.lat] },
          properties: {
            id: c.username,
            label: c.username,
            heading: c.heading ?? -1,
            mine: c.mine ? 1 : 0,
            stale: c.ageSec * 1000 + Math.max(0, now - fetchedAt) > CHASER_STALE_MS ? 1 : 0,
          },
        })),
    }),
    [chasers, fetchedAt, now],
  );

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "chaser-dot",
        type: "circle",
        source: SRC,
        filter: ["<", ["get", "heading"], 0],
        paint: {
          "circle-radius": 6,
          "circle-color": ["case", ["==", ["get", "mine"], 1], MY_CHASER_COLOR, CHASER_COLOR],
          "circle-stroke-color": "#000000",
          "circle-stroke-width": 2,
          "circle-opacity": ["case", ["==", ["get", "stale"], 1], 0.45, 1],
          "circle-stroke-opacity": ["case", ["==", ["get", "stale"], 1], 0.45, 1],
        },
      },
      {
        id: "chaser-arrow",
        type: "symbol",
        source: SRC,
        filter: [">=", ["get", "heading"], 0],
        layout: {
          "icon-image": ["case", ["==", ["get", "mine"], 1], "chaser-arrow-mine", "chaser-arrow"],
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": ["case", ["==", ["get", "stale"], 1], 0.45, 1] },
      },
      {
        id: "chaser-label",
        type: "symbol",
        source: SRC,
        minzoom: 6,
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 11, "text-anchor": "left", "text-offset": [1.1, 0], "text-max-width": 12 },
        paint: {
          "text-color": ["case", ["==", ["get", "mine"], 1], MY_CHASER_COLOR, CHASER_COLOR],
          "text-halo-color": "#000000",
          "text-halo-width": 1.2,
          "text-opacity": ["case", ["==", ["get", "stale"], 1], 0.6, 1],
        },
      },
    ],
    SLOTS.reports,
  );

  // Declared after the layers, so on unmount React removes them before the images they use.
  useEffect(
    () => () => {
      if (!mapAlive(map)) return;
      for (const id of Object.keys(ARROWS)) if (map.hasImage(id)) map.removeImage(id);
    },
    [map],
  );

  useLayerClick(["chaser-dot", "chaser-arrow"], (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
