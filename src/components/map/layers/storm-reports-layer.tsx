"use client";

import type { Feature, FeatureCollection } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { useFormat } from "@/hooks/use-format";
import { reportMagnitude, type ReportGroup } from "@/lib/feeds/storm-parse";
import type { StormReport, StormReportKind } from "@/lib/feeds/storm-reports";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";
import { useGeoJsonLayers } from "./use-geojson-source";

const SRC = "storm-reports";

/**
 * Report colours. They follow the SPC storm-report map where a convention
 * exists (tornado red, hail green, wind blue) and are lifted in lightness so
 * they read on the near-black basemap:
 *
 * | kind               | colour    | mark                                         |
 * |--------------------|-----------|----------------------------------------------|
 * | tornado, waterspout| `#ff453a` | filled red dot                               |
 * | funnel cloud       | `#ff453a` | hollow red ring (rotation, no ground contact)|
 * | hail               | `#4cd964` | green                                        |
 * | wind gust, damage  | `#4d8dff` | blue                                         |
 * | flood, heavy rain  | `#1f9e74` | dark green (NWS flood products are green)    |
 * | snow, sleet, ice   | `#9fd6ff` | light blue                                   |
 * | other              | `#9aa0a6` | grey                                         |
 *
 * Selection is a white ring, never the accent blue (too close to wind).
 */
export const REPORT_COLORS: Record<StormReportKind, string> = {
  tornado: "#ff453a",
  funnel: "#ff453a",
  hail: "#4cd964",
  wind: "#4d8dff",
  "wind-damage": "#4d8dff",
  flood: "#1f9e74",
  rain: "#1f9e74",
  snow: "#9fd6ff",
  other: "#9aa0a6",
};

/** The same colours by summary bucket (see `reportGroup`). */
export const REPORT_GROUP_COLORS: Record<ReportGroup, string> = {
  tornado: REPORT_COLORS.tornado,
  hail: REPORT_COLORS.hail,
  wind: REPORT_COLORS.wind,
  flood: REPORT_COLORS.flood,
  other: REPORT_COLORS.other,
};

/** Paint order: the most dangerous kinds on top. */
const RANK: Record<StormReportKind, number> = { tornado: 8, funnel: 7, hail: 6, "wind-damage": 5, wind: 5, flood: 4, rain: 3, snow: 2, other: 1 };

/** Significant severe (SPC): hail ≥ 2" (50.8 mm), wind ≥ 65 kt (33.4 m/s); tornadoes always. */
const SIG_HAIL_MM = 50.8;
const SIG_WIND_MS = 33.4;

/** Opacity from 1 for a fresh report to 0.35 at the end of the window (`age` is 0–1). */
const FADE: ExpressionSpecification = ["interpolate", ["linear"], ["get", "age"], 0, 1, 1, 0.35];
const HOLLOW: ExpressionSpecification = ["==", ["get", "hollow"], 1];

/**
 * Official NWS local storm reports: one dot per report, coloured by kind,
 * larger for tornadoes and significant hail or wind, fading with age over the
 * window. Hail sizes and wind speeds label the dots from zoom 8.
 */
export function StormReportsLayer({
  reports,
  now,
  selectedId,
  onSelect,
  hours = 6,
}: {
  reports: StormReport[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Length of the report window; reports fade over it. */
  hours?: number;
}) {
  const fmt = useFormat();
  const data = useMemo<FeatureCollection>(() => {
    const windowMin = Math.max(1, hours) * 60;
    const features: Feature[] = reports.map((r) => {
      const ageMin = Math.max(0, (now - Date.parse(r.time)) / 60_000);
      const age = Number.isFinite(ageMin) ? Math.min(1, ageMin / windowMin) : 1;
      const m = reportMagnitude(r);
      const sig =
        r.kind === "tornado" ||
        (r.kind === "hail" && m?.kind === "length" && m.mm >= SIG_HAIL_MM) ||
        ((r.kind === "wind" || r.kind === "wind-damage") && m?.kind === "speed" && m.ms >= SIG_WIND_MS);
      const label =
        r.kind === "hail" && m?.kind === "length" ? fmt.precip(m.mm) : (r.kind === "wind" || r.kind === "wind-damage") && m?.kind === "speed" ? fmt.wind(m.ms) : "";
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
        properties: {
          id: r.id,
          color: REPORT_COLORS[r.kind] ?? REPORT_COLORS.other,
          hollow: r.kind === "funnel" ? 1 : 0,
          r: sig ? 6.5 : 4.5,
          // Newer reports of the same kind paint above older ones.
          z: (RANK[r.kind] ?? 0) * 10 + (1 - age) * 9,
          age,
          label,
        },
      };
    });
    return { type: "FeatureCollection", features };
  }, [reports, now, hours, fmt]);

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "lsr-dot",
        type: "circle",
        source: SRC,
        layout: { "circle-sort-key": ["get", "z"] },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["*", 0.75, ["get", "r"]], 9, ["get", "r"]],
          "circle-color": ["get", "color"],
          "circle-opacity": ["case", HOLLOW, 0, FADE],
          "circle-stroke-color": ["case", HOLLOW, ["get", "color"], "#000000"],
          "circle-stroke-width": ["case", HOLLOW, 2, 1],
          "circle-stroke-opacity": FADE,
        },
      },
      {
        id: "lsr-selected",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": ["+", ["get", "r"], 5], "circle-opacity": 0, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      },
      {
        id: "lsr-label",
        type: "symbol",
        source: SRC,
        minzoom: 8,
        filter: ["!=", ["get", "label"], ""],
        layout: {
          "text-field": ["get", "label"],
          "text-font": font,
          "text-size": 10,
          "text-anchor": "left",
          "text-offset": [0.9, 0],
          "symbol-sort-key": ["-", 0, ["get", "z"]],
        },
        paint: { "text-color": "#ececed", "text-halo-color": "#000000", "text-halo-width": 1.2, "text-opacity": FADE },
      },
    ],
    SLOTS.stormReports,
  );

  const { map } = useMapContext();
  useEffect(() => {
    if (mapAlive(map) && map.getLayer("lsr-selected")) map.setFilter("lsr-selected", ["==", ["get", "id"], selectedId ?? ""]);
  }, [map, selectedId]);

  useLayerClick(["lsr-dot"], (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onSelect(id);
  });
  return null;
}
