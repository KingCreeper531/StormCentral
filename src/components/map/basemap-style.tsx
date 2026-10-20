"use client";

import { NavigationControl, type GeoJSONSourceSpecification, type Map as MlMap, type SkySpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import {
  basemapOps,
  countyLineColor,
  countyLineWidth,
  hillshadePaint,
  insertionPoints,
  MAX_PITCH,
  skyFor,
  START_PITCH,
  TERRAIN_SOURCE,
} from "@/lib/map/style";
import { useMapStyleStore } from "@/store/map-style-store";
import { mapAlive, SLOTS, useMapContext } from "./map-view";

type LayoutProp = Parameters<MlMap["setLayoutProperty"]>[1];
type PaintProp = Parameters<MlMap["setPaintProperty"]>[1];

const HILLSHADE = "terrain-shade";
const DEM_SHADE = "terrain-dem-shade";
// Terrain and hillshade read the same tiles through separate sources: MapLibre renders both better that way.
const DEM_3D = "terrain-dem-3d";
const COUNTIES = "county-lines";

/** Our county lines for zoomed-out views, fetched once (scripts/vendor-county-lines.mjs). */
let countyLines: Promise<GeoJSONSourceSpecification["data"] | null> | null = null;
const loadCountyLines = () =>
  (countyLines ??= fetch("/vendor/us-county-lines.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      countyLines = null;
      return null;
    }));

function removeLayer(map: MlMap, id: string) {
  if (map.getLayer(id)) map.removeLayer(id);
}
function removeSource(map: MlMap, id: string) {
  if (map.getSource(id)) map.removeSource(id);
}

/**
 * Applies the map style (lib/map/style.ts) to the map it's mounted in: the
 * basemap's borders, roads, labels and colours, terrain shading, county
 * lines when zoomed out and, where `allow3d`, 3D terrain with tilting.
 */
export function BasemapStyle({ allow3d }: { allow3d: boolean }) {
  const { map, baseLayers, dark, satellite } = useMapContext();
  const style = useMapStyleStore((s) => s.style);
  const points = useMemo(() => insertionPoints(baseLayers), [baseLayers]);

  // The basemap's own layers.
  useEffect(() => {
    if (!mapAlive(map)) return;
    for (const op of basemapOps(baseLayers, style, { dark, satellite })) {
      if (!map.getLayer(op.id)) continue;
      for (const [prop, value] of Object.entries(op.layout)) map.setLayoutProperty(op.id, prop as LayoutProp, value as never);
      for (const [prop, value] of Object.entries(op.paint)) map.setPaintProperty(op.id, prop as PaintProp, value as never);
    }
  }, [map, baseLayers, style, dark, satellite]);

  // Terrain shading.
  const shade = style.hillshade;
  // The layer stays while only its strength changes.
  const shading = shade > 0;
  useEffect(() => {
    if (!mapAlive(map) || !shading) return;
    map.addSource(DEM_SHADE, { ...TERRAIN_SOURCE, tiles: [...TERRAIN_SOURCE.tiles] });
    const before = points.hillshade && map.getLayer(points.hillshade) ? points.hillshade : SLOTS.base;
    const paint = hillshadePaint(useMapStyleStore.getState().style.hillshade, dark);
    map.addLayer({ id: HILLSHADE, type: "hillshade", source: DEM_SHADE, paint: paint as never }, map.getLayer(before) ? before : undefined);
    return () => {
      if (!mapAlive(map)) return;
      removeLayer(map, HILLSHADE);
      removeSource(map, DEM_SHADE);
    };
  }, [map, shading, points.hillshade, dark]);
  useEffect(() => {
    if (!mapAlive(map) || !map.getLayer(HILLSHADE)) return;
    for (const [prop, value] of Object.entries(hillshadePaint(shade, dark))) map.setPaintProperty(HILLSHADE, prop as PaintProp, value as never);
  }, [map, shade, dark]);

  // County lines when zoomed out, handing over to the basemap's own at its county zoom.
  const allCounties = style.counties.show === "always";
  useEffect(() => {
    if (!mapAlive(map) || !allCounties) return;
    let alive = true;
    void loadCountyLines().then((data) => {
      if (!alive || !data || !mapAlive(map) || map.getSource(COUNTIES)) return;
      map.addSource(COUNTIES, { type: "geojson", data, maxzoom: 10, tolerance: 0.6 });
      const before = points.counties && map.getLayer(points.counties) ? points.counties : SLOTS.base;
      map.addLayer(
        {
          id: COUNTIES,
          type: "line",
          source: COUNTIES,
          minzoom: 3.5,
          maxzoom: points.countyMinzoom,
          layout: { "line-join": "round" },
          paint: { "line-color": countyLineColor(baseLayers, useMapStyleStore.getState().style, dark), "line-width": countyLineWidth(useMapStyleStore.getState().style.counties.width) as never },
        },
        map.getLayer(before) ? before : undefined,
      );
    });
    return () => {
      alive = false;
      if (!mapAlive(map)) return;
      removeLayer(map, COUNTIES);
      removeSource(map, COUNTIES);
    };
  }, [map, allCounties, points, baseLayers, dark]);
  const countyColor = countyLineColor(baseLayers, style, dark);
  const countyWidth = style.counties.width;
  useEffect(() => {
    if (!mapAlive(map) || !map.getLayer(COUNTIES)) return;
    map.setPaintProperty(COUNTIES, "line-color", countyColor);
    map.setPaintProperty(COUNTIES, "line-width", countyLineWidth(countyWidth) as never);
  }, [map, countyColor, countyWidth]);

  // 3D terrain: the map tilts (right-drag, two fingers, or the compass control) while it's on.
  const terrain = allow3d && style.terrain3d;
  useEffect(() => {
    if (!mapAlive(map) || !terrain) return;
    map.addSource(DEM_3D, { ...TERRAIN_SOURCE, tiles: [...TERRAIN_SOURCE.tiles] });
    map.setTerrain({ source: DEM_3D, exaggeration: useMapStyleStore.getState().style.exaggeration });
    map.setSky(skyFor(dark) as SkySpecification);
    map.setMaxPitch(MAX_PITCH);
    map.dragRotate.enable();
    map.touchPitch.enable();
    const compass = new NavigationControl({ showZoom: false, showCompass: true, visualizePitch: true });
    map.addControl(compass, "bottom-right");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (map.getPitch() < 5) map.easeTo({ pitch: START_PITCH, duration: reduced ? 0 : 900 });
    return () => {
      if (!mapAlive(map)) return;
      map.removeControl(compass);
      map.setTerrain(null);
      removeSource(map, DEM_3D);
      map.dragRotate.disable();
      map.touchPitch.disable();
      // Back to flat and north up; tilting stays locked once it's there.
      map.easeTo({ pitch: 0, bearing: 0, duration: reduced ? 0 : 600 });
      map.once("moveend", () => {
        if (mapAlive(map) && !map.getTerrain()) map.setMaxPitch(0);
      });
    };
  }, [map, terrain, dark]);
  const exaggeration = style.exaggeration;
  useEffect(() => {
    if (mapAlive(map) && map.getTerrain()) map.setTerrain({ source: DEM_3D, exaggeration });
  }, [map, exaggeration]);

  return null;
}
