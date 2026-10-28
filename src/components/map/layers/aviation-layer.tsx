"use client";

import type { FeatureCollection } from "geojson";
import { useMemo } from "react";
import type { AirportRow, AviationAdvisory } from "@/lib/aviation";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import {
  ADVISORIES_SRC,
  ADVISORY_HIT_LAYERS,
  ADVISORY_SELECTED_SRC,
  advisoryFeature,
  advisoryLayers,
  advisorySelectedLayers,
  AIRPORT_HIT_LAYERS,
  AIRPORT_SELECTED_SRC,
  airportFeature,
  airportLayers,
  AIRPORTS_SRC,
  airportSelectedLayers,
} from "./aviation-style";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const collection = (features: FeatureCollection["features"]): FeatureCollection => ({ type: "FeatureCollection", features });

/**
 * Aviation weather: a dot per airport coloured by flight category (VFR green,
 * MVFR blue, IFR red, LIFR magenta), and SIGMET / AIRMET outlines under the
 * NWS warnings. The open airport or advisory is drawn on its own source,
 * ringed in white, so selecting one doesn't rebuild the rest.
 */
export function AviationLayer({
  airports,
  advisories,
  selectedAirport,
  selectedAdvisory,
  onSelectAirport,
  onSelectAdvisory,
}: {
  airports: AirportRow[];
  advisories: AviationAdvisory[];
  selectedAirport: string | null;
  selectedAdvisory: string | null;
  onSelectAirport: (id: string) => void;
  onSelectAdvisory: (id: string) => void;
}) {
  const { map, basemap } = useMapContext();

  const airportData = useMemo(() => collection(airports.map(airportFeature)), [airports]);
  const airportSelected = useMemo(() => {
    const row = selectedAirport ? airports.find((a) => a[0] === selectedAirport) : undefined;
    return collection(row ? [airportFeature(row)] : []);
  }, [airports, selectedAirport]);
  const advisoryData = useMemo(() => collection(advisories.map(advisoryFeature)), [advisories]);
  const advisorySelected = useMemo(() => {
    const a = selectedAdvisory ? advisories.find((x) => x.id === selectedAdvisory) : undefined;
    return collection(a ? [advisoryFeature(a)] : []);
  }, [advisories, selectedAdvisory]);

  // Outlines under the warnings; airports with the other point layers, the open one above them.
  useGeoJsonLayers(ADVISORIES_SRC, advisoryData, advisoryLayers, SLOTS.warnings);
  useGeoJsonLayers(ADVISORY_SELECTED_SRC, advisorySelected, advisorySelectedLayers, SLOTS.warnings);
  useGeoJsonLayers(AIRPORTS_SRC, airportData, airportLayers, SLOTS.sites);
  useGeoJsonLayers(AIRPORT_SELECTED_SRC, airportSelected, airportSelectedLayers, SLOTS.sites);

  useLayerClick(AIRPORT_HIT_LAYERS, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelectAirport(id);
  });

  useLayerClick(ADVISORY_HIT_LAYERS, (e) => {
    if (!mapAlive(map)) return;
    // An advisory can cover several states: a tap on a warning, an airport or another marker drawn above it is theirs.
    const top = map.queryRenderedFeatures(e.point).find((f) => !basemap.has(f.layer.id));
    if (top && !ADVISORY_HIT_LAYERS.includes(top.layer.id)) return;
    const id = top?.properties?.id ?? e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelectAdvisory(id);
  });
  return null;
}
