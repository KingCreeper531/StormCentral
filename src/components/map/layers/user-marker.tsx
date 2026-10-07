"use client";

import { Marker } from "maplibre-gl";
import { useEffect } from "react";
import { mapAlive, useMapContext } from "../map-view";

/** Pulsing "you are here" marker (DOM marker → stays crisp above all layers). */
export function UserMarker({ lat, lon }: { lat: number; lon: number }) {
  const { map } = useMapContext();
  useEffect(() => {
    if (!map) return;
    const el = document.createElement("div");
    el.className = "relative grid size-5 place-items-center";
    el.setAttribute("aria-label", "Selected location");
    const ring = document.createElement("span");
    ring.className = "absolute inset-0 rounded-full bg-sky-400/60 animate-pulse-ring";
    const dot = document.createElement("span");
    dot.className = "relative size-3 rounded-full bg-sky-400 ring-2 ring-white shadow-[0_0_12px_rgba(56,189,248,.9)]";
    el.append(ring, dot);
    const marker = new Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
    return () => {
      if (mapAlive(map)) marker.remove();
    };
  }, [map, lat, lon]);
  return null;
}
