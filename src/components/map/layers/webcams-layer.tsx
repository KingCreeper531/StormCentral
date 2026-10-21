"use client";

import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, MapStyleImageMissingEvent } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import type { Webcam } from "@/lib/webcams";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";
import { webcamIcon } from "./webcam-icon";
import {
  WEBCAM_CLUSTER_MAX_ZOOM,
  WEBCAM_CLUSTERING,
  WEBCAM_ICONS,
  WEBCAM_SELECTED_SRC,
  webcamFeature,
  webcamLayers,
  WEBCAMS_SRC,
  webcamSelectedLayers,
} from "./webcams-style";

/**
 * Live cameras: a round camera badge per camera, coloured by kind (traffic,
 * wildfire, river, volcano). Thousands of them, so cameras that would pile up
 * merge into a bubble with their count until you zoom in (tapping one zooms
 * to it). The open camera always shows on top, ringed in white, even inside
 * a bubble.
 */
export function WebcamsLayer({ cams, selectedId, onSelect }: { cams: Webcam[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { map } = useMapContext();

  // Register the badges before the layers below are added (effects run in order).
  useEffect(() => {
    if (!mapAlive(map)) return;
    const add = () => {
      for (const [id, color] of WEBCAM_ICONS) {
        if (!mapAlive(map) || map.hasImage(id)) continue;
        const img = webcamIcon(color);
        if (img) map.addImage(id, img, { pixelRatio: 2 });
      }
    };
    add();
    // A style reload drops runtime images: put them back once the new style is in.
    const onMissing = (e: MapStyleImageMissingEvent) => {
      if (WEBCAM_ICONS.has(e.id)) add();
    };
    map.on("styledata", add);
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styledata", add);
      map.off("styleimagemissing", onMissing);
    };
  }, [map]);

  // Selection lives in its own source, so opening a camera doesn't re-cluster thousands.
  const data = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features: cams.map(webcamFeature) }), [cams]);
  const selected = useMemo<FeatureCollection>(() => {
    const cam = selectedId ? cams.find((c) => c.id === selectedId) : undefined;
    return { type: "FeatureCollection", features: cam ? [webcamFeature(cam)] : [] };
  }, [cams, selectedId]);

  useGeoJsonLayers(WEBCAMS_SRC, data, webcamLayers, SLOTS.reports, WEBCAM_CLUSTERING);
  // Added second, so it draws above the bubbles and badges.
  useGeoJsonLayers(WEBCAM_SELECTED_SRC, selected, webcamSelectedLayers, SLOTS.reports);

  // A bubble zooms in until its cameras come apart.
  useLayerClick(["webcam-cluster"], (e) => {
    const f = e.features?.[0];
    const clusterId = f?.properties?.cluster_id;
    if (!mapAlive(map) || typeof clusterId !== "number" || f?.geometry.type !== "Point") return;
    const [lon, lat] = f.geometry.coordinates;
    void (map.getSource(WEBCAMS_SRC) as GeoJSONSource | undefined)
      ?.getClusterExpansionZoom(clusterId)
      .then((zoom) => mapAlive(map) && map.easeTo({ center: [lon!, lat!], zoom: Math.min(zoom, WEBCAM_CLUSTER_MAX_ZOOM + 1) }))
      .catch(() => {});
  });

  useLayerClick(["webcam-icon", "webcam-selected-icon"], (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
