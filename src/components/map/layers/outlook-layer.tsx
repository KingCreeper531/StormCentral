"use client";

import type { FeatureCollection } from "geojson";
import { useMemo } from "react";
import type { OutlookFeature } from "@/lib/api/types";
import { SLOTS } from "../map-view";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "spc-outlook";

/** SPC Day-1 categorical convective outlook (official SPC fills). */
export function OutlookLayer({ features }: { features: OutlookFeature[] }) {
  const data = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features }), [features]);
  useGeoJsonLayers(
    SRC,
    data,
    () => [
      { id: "spc-fill", type: "fill", source: SRC, paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.16 } },
      { id: "spc-line", type: "line", source: SRC, paint: { "line-color": ["get", "stroke"], "line-width": 1.2, "line-opacity": 0.8 } },
    ],
    SLOTS.outlook,
  );
  return null;
}
