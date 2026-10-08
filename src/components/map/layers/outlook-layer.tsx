"use client";

import type { FeatureCollection } from "geojson";
import type { MapStyleImageMissingEvent } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import type { OutlookFeature, OutlookKind } from "@/lib/api/types";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "spc-outlook";
/** Diagonal hatch for significant-severe areas. */
export const SPC_HATCH_IMAGE = "spc-sig-hatch";

const fillOpacity = (kind: OutlookKind) => (kind === "categorical" ? 0.16 : 0.18);

/**
 * An 8 px tile of "/" diagonals, drawn at 2× for crisp edges. SPC hatches in
 * black on a white map; on our near-black basemap the line is light with a dark
 * rim, so it reads over the dark ground, the probability fills and radar alike.
 */
function hatchImage(): ImageData | null {
  const ratio = 2;
  const size = 8 * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const stroke = (color: string, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width * ratio;
    g.beginPath();
    // The tile's diagonal plus its neighbours' corner pieces, so tiles join seamlessly.
    for (const o of [-size, 0, size]) {
      g.moveTo(o - 1, size + 1);
      g.lineTo(o + size + 1, -1);
    }
    g.stroke();
  };
  stroke("rgba(0,0,0,0.5)", 2.25);
  stroke("rgba(255,255,255,0.8)", 1);
  return g.getImageData(0, 0, size, size);
}

/**
 * SPC Day 1 convective outlook.
 * - `categorical`: SPC's TSTM–HIGH fills.
 * - `tornado` / `hail` / `wind`: probability contours in SPC's colours, with
 *   significant-severe areas hatched and edged in a black/white dash.
 */
export function OutlookLayer({ features, kind = "categorical" }: { features: OutlookFeature[]; kind?: OutlookKind }) {
  const { map } = useMapContext();

  // Register the hatch before the layers below are added (effects run in order).
  useEffect(() => {
    if (!mapAlive(map)) return;
    const add = () => {
      if (!mapAlive(map) || map.hasImage(SPC_HATCH_IMAGE)) return;
      const img = hatchImage();
      if (img) map.addImage(SPC_HATCH_IMAGE, img, { pixelRatio: 2 });
    };
    add();
    // A style reload drops runtime images: put it back as soon as the new style
    // is in. (The map's missing-image resolver is a single slot, so it is left
    // alone; the event is only a backstop and can't satisfy the current request.)
    const onMissing = (e: MapStyleImageMissingEvent) => {
      if (e.id === SPC_HATCH_IMAGE) add();
    };
    map.on("styledata", add);
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styledata", add);
      map.off("styleimagemissing", onMissing);
    };
  }, [map]);

  const data = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features }), [features]);
  useGeoJsonLayers(
    SRC,
    data,
    () => [
      {
        id: "spc-fill",
        type: "fill",
        source: SRC,
        filter: ["!", ["to-boolean", ["get", "significant"]]],
        paint: { "fill-color": ["get", "fill"], "fill-opacity": fillOpacity(kind) },
      },
      {
        id: "spc-line",
        type: "line",
        source: SRC,
        filter: ["!", ["to-boolean", ["get", "significant"]]],
        paint: { "line-color": ["get", "stroke"], "line-width": 1.2, "line-opacity": 0.8 },
      },
      {
        id: "spc-sig-hatch",
        type: "fill",
        source: SRC,
        filter: ["to-boolean", ["get", "significant"]],
        paint: { "fill-pattern": SPC_HATCH_IMAGE },
      },
      // Black under white dashes: an alternating black/white edge that holds up on any fill.
      {
        id: "spc-sig-casing",
        type: "line",
        source: SRC,
        filter: ["to-boolean", ["get", "significant"]],
        paint: { "line-color": "#000000", "line-width": 1.6, "line-opacity": 0.9 },
      },
      {
        id: "spc-sig-line",
        type: "line",
        source: SRC,
        filter: ["to-boolean", ["get", "significant"]],
        paint: { "line-color": "#ffffff", "line-width": 1.6, "line-dasharray": [2, 2] },
      },
    ],
    SLOTS.outlook,
  );

  // Layer specs are fixed at mount; follow kind changes imperatively.
  useEffect(() => {
    if (mapAlive(map) && map.getLayer("spc-fill")) map.setPaintProperty("spc-fill", "fill-opacity", fillOpacity(kind));
  }, [map, kind]);

  // Declared after the layers, so on unmount React removes them before the image they use.
  useEffect(
    () => () => {
      if (mapAlive(map) && map.hasImage(SPC_HATCH_IMAGE)) map.removeImage(SPC_HATCH_IMAGE);
    },
    [map],
  );

  return null;
}
