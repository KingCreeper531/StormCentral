"use client";

import type { AddLayerObject, GeoJSONSource, GeoJSONSourceSpecification } from "maplibre-gl";
import { useEffect } from "react";
import type { FeatureCollection } from "geojson";
import { mapAlive, useMapContext } from "../map-view";

/**
 * Creates a GeoJSON source + layers once, then streams data updates through
 * setData (no layer teardown → no flicker). `source` adds options such as
 * clustering; like the layers, it's read once per mount.
 */
export function useGeoJsonLayers(
  sourceId: string,
  data: FeatureCollection,
  layers: (font: string[]) => AddLayerObject[],
  beforeId: string,
  source?: Omit<GeoJSONSourceSpecification, "type" | "data">,
) {
  const { map, font } = useMapContext();

  useEffect(() => {
    if (!map) return;
    map.addSource(sourceId, { ...source, type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const specs = layers(font);
    for (const l of specs) map.addLayer(l, beforeId);
    return () => {
      if (!mapAlive(map)) return;
      for (const l of specs) if (map.getLayer(l.id)) map.removeLayer(l.id);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
    // Layer specs are static per mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sourceId]);

  useEffect(() => {
    (map?.getSource(sourceId) as GeoJSONSource | undefined)?.setData(data);
  }, [map, sourceId, data]);

  return map;
}
