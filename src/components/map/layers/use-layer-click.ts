"use client";

import type { MapLayerMouseEvent, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { mapAlive, useMapContext } from "../map-view";

/** Maps where a tool (the measuring tool) has the clicks for now: their layers select nothing meanwhile. */
const claimed = new WeakSet<MlMap>();
export function claimClicks(map: MlMap, on: boolean) {
  if (on) claimed.add(map);
  else claimed.delete(map);
}

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
    const click = (e: MapLayerMouseEvent) => {
      if (!claimed.has(map)) cb.current(e);
    };
    const cursor = (c: string) => () => {
      if (!claimed.has(map)) map.getCanvas().style.cursor = c;
    };
    const enter = cursor("pointer");
    const leave = cursor("");
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
