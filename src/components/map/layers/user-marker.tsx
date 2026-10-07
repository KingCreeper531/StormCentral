"use client";

import { Marker } from "maplibre-gl";
import { useEffect } from "react";
import { mapAlive, useMapContext } from "../map-view";

/**
 * "You are here" marker: a 20 px white disc with a 10 px accent centre and a
 * 1 px dark outer edge so it holds up over bright radar. Map data never uses
 * this shape (reports are coloured dots, the selected radar site is a square),
 * so it can't be mistaken for a report under it. Static, no glow. A DOM
 * marker, so it always draws above the map's own layers; it ignores pointer
 * events so a report underneath stays tappable.
 */
export function UserMarker({ lat, lon }: { lat: number; lon: number }) {
  const { map } = useMapContext();
  useEffect(() => {
    if (!map) return;
    const el = document.createElement("div");
    el.className = "pointer-events-none grid size-5 place-items-center rounded-full bg-white ring-1 ring-black/70";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Selected location");
    const dot = document.createElement("span");
    dot.className = "block size-2.5 rounded-full bg-accent";
    el.append(dot);
    const marker = new Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
    return () => {
      if (mapAlive(map)) marker.remove();
    };
  }, [map, lat, lon]);
  return null;
}
