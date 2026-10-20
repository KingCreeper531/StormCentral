"use client";

import type { Map as MlMap } from "maplibre-gl";
import { useEffect } from "react";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { SATELLITE_MAP_BRIGHTNESS, SATELLITE_MAP_ID, SATELLITE_MAP_LABELS, SATELLITE_MAP_SOURCE, satelliteMapPlan } from "@/lib/radar/satellite-map";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

type PaintProp = Parameters<MlMap["setPaintProperty"]>[1];
type PaintValue = Parameters<MlMap["setPaintProperty"]>[2];

/**
 * Cloud-free satellite pictures of the ground in place of the plain basemap
 * (lib/radar/satellite-map.ts): under the radar and everything else of ours,
 * with the basemap's borders, roads and place names on top. Its area fills
 * are hidden and its labels restyled while this is mounted; both come back
 * when it's removed.
 */
export function SatelliteMapLayer() {
  const { map, basemap } = useMapContext();
  const theme = useResolvedTheme();

  useEffect(() => {
    if (!mapAlive(map)) return;
    const plan = satelliteMapPlan(map.getStyle().layers, basemap);
    const hidden: string[] = [];
    for (const id of plan.hide) {
      if (map.getLayoutProperty(id, "visibility") === "none") continue;
      map.setLayoutProperty(id, "visibility", "none");
      hidden.push(id);
    }
    const restyled: [string, PaintProp, PaintValue][] = [];
    for (const id of plan.labels) {
      for (const [prop, value] of Object.entries(SATELLITE_MAP_LABELS) as [PaintProp, PaintValue][]) {
        restyled.push([id, prop, map.getPaintProperty(id, prop) as PaintValue]);
        map.setPaintProperty(id, prop, value);
      }
    }
    const before = plan.before ?? SLOTS.base;
    map.addSource(SATELLITE_MAP_ID, { type: "raster", ...SATELLITE_MAP_SOURCE, tiles: [...SATELLITE_MAP_SOURCE.tiles] });
    map.addLayer({ id: SATELLITE_MAP_ID, type: "raster", source: SATELLITE_MAP_ID, paint: { "raster-fade-duration": 0, "raster-brightness-max": SATELLITE_MAP_BRIGHTNESS[theme] } }, map.getLayer(before) ? before : undefined);
    return () => {
      if (!mapAlive(map)) return;
      if (map.getLayer(SATELLITE_MAP_ID)) map.removeLayer(SATELLITE_MAP_ID);
      if (map.getSource(SATELLITE_MAP_ID)) map.removeSource(SATELLITE_MAP_ID);
      for (const id of hidden) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
      for (const [id, prop, value] of restyled) if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
    };
  }, [map, basemap, theme]);

  return null;
}
