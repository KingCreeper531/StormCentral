"use client";

import type { LayerSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { expandTileUrl, type PluginLayer } from "@/lib/addons/manifest";
import { useAddonsStore } from "@/store/addons-store";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

/** Short, stable, id-safe hash of a plugin's source URL. */
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface Entry {
  key: string;
  layer: PluginLayer;
  opacity: number;
}

function layersFor({ key, layer: l, opacity }: Entry): { spec: LayerSpecification; before: string }[] {
  if (l.kind === "raster") {
    return [{ spec: { id: key, type: "raster", source: key, paint: { "raster-opacity": l.opacity * opacity, "raster-fade-duration": 0 } }, before: SLOTS.tropical }];
  }
  const a = l.opacity * opacity;
  const geom = (t: string[]) => ["in", ["geometry-type"], ["literal", t]] as never;
  return [
    { spec: { id: `${key}-fill`, type: "fill", source: key, filter: geom(["Polygon", "MultiPolygon"]), paint: { "fill-color": l.color, "fill-opacity": a * 0.35 } }, before: SLOTS.tropical },
    {
      spec: { id: `${key}-line`, type: "line", source: key, filter: geom(["Polygon", "MultiPolygon", "LineString", "MultiLineString"]), paint: { "line-color": l.color, "line-width": 1.5, "line-opacity": a } },
      before: SLOTS.tracks,
    },
    {
      spec: {
        id: `${key}-point`,
        type: "circle",
        source: key,
        filter: geom(["Point", "MultiPoint"]),
        paint: { "circle-color": l.color, "circle-radius": 4, "circle-opacity": a, "circle-stroke-color": "#000000", "circle-stroke-width": 1 },
      },
      before: SLOTS.sites,
    },
  ];
}

/**
 * Map layers from enabled GitHub plugins (tile services and GeoJSON). Rendered
 * by every interactive MapView. Raster and fills sit above the radar and below
 * warning polygons; lines and points above the basemap labels.
 */
export function PluginLayers() {
  const { map } = useMapContext();
  const plugins = useAddonsStore((s) => s.plugins);
  const entries = useMemo<Entry[]>(
    () =>
      plugins
        .filter((p) => p.enabled)
        .flatMap((p) => p.layers.filter((l) => !p.hidden.includes(l.id)).map((layer) => ({ key: `plg-${hash(p.id)}-${layer.id}`, layer, opacity: p.opacity }))),
    [plugins],
  );

  useEffect(() => {
    if (!mapAlive(map) || !entries.length) return;
    const added: { sources: string[]; layers: string[] } = { sources: [], layers: [] };
    for (const e of entries) {
      try {
        const l = e.layer;
        map.addSource(
          e.key,
          l.kind === "raster"
            ? { type: "raster", tiles: l.tiles.map((t) => expandTileUrl(t, Date.now())), tileSize: l.tileSize, minzoom: l.minzoom, maxzoom: l.maxzoom, ...(l.attribution ? { attribution: l.attribution } : {}) }
            : { type: "geojson", data: l.url, ...(l.attribution ? { attribution: l.attribution } : {}) },
        );
        added.sources.push(e.key);
        for (const { spec, before } of layersFor(e)) {
          map.addLayer(spec, map.getLayer(before) ? before : undefined);
          added.layers.push(spec.id);
        }
      } catch (err) {
        // A bad layer from one plugin must not take down the map.
        console.warn("[plugins] layer skipped:", e.key, err);
      }
    }
    return () => {
      if (!mapAlive(map)) return;
      for (const id of added.layers) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of added.sources) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, entries]);

  return null;
}
