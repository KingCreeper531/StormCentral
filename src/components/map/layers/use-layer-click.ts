"use client";

import type { MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { mapAlive, useMapContext } from "../map-view";

/** Click + pointer-cursor behaviour for one or more interactive layers. */
export function useLayerClick(layerIds: string[], onClick: (e: MapLayerMouseEvent) => void) {
  const { map } = useMapContext();
  const cb = useRef(onClick);
  useEffect(() => {
    cb.current = onClick;
  });
  const key = layerIds.join("|");
  useEffect(() => {
    if (!map) return;
    const ids = key.split("|");
    const click = (e: MapLayerMouseEvent) => cb.current(e);
    const enter = () => (map.getCanvas().style.cursor = "pointer");
    const leave = () => (map.getCanvas().style.cursor = "");
    for (const id of ids) {
      map.on("click", id, click);
      map.on("mouseenter", id, enter);
      map.on("mouseleave", id, leave);
    }
    return () => {
      if (!mapAlive(map)) return;
      for (const id of ids) {
        map.off("click", id, click);
        map.off("mouseenter", id, enter);
        map.off("mouseleave", id, leave);
      }
    };
  }, [map, key]);
}
