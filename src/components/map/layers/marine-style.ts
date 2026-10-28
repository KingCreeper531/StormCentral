import type { Feature } from "geojson";
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import type { Buoy } from "@/lib/feeds/buoys";
import { WAVE_STOPS } from "@/lib/marine";

/** Map sources: every buoy, the open one on its own, and the wave forecast's direction arrows. */
export const BUOYS_SRC = "buoys";
export const BUOY_SELECTED_SRC = "buoy-selected";
export const WAVE_ARROWS_SRC = "wave-arrows";
/** The wave arrow image (drawn in wave-arrow-icon). */
export const WAVE_ARROW_ICON = "wave-arrow";

/** A station without a wave sensor (coastal stations, most partners): grey. */
export const NO_WAVES_COLOR = "#9aa0a6";

/** Dot colour from the wave height scale (lib/marine), grey where the station measures no waves. */
const WAVE_COLOR = [
  "case",
  ["==", ["typeof", ["get", "wave"]], "number"],
  ["interpolate", ["linear"], ["get", "wave"], ...WAVE_STOPS.flat()],
  NO_WAVES_COLOR,
] as unknown as ExpressionSpecification;
/** Wave buoys are what this layer is about: they draw larger than stations without waves. */
const RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  3,
  ["case", ["==", ["typeof", ["get", "wave"]], "number"], 4, 2.5],
  8,
  ["case", ["==", ["typeof", ["get", "wave"]], "number"], 7, 4.5],
  12,
  ["case", ["==", ["typeof", ["get", "wave"]], "number"], 9, 6],
];

export const buoyFeature = (b: Buoy): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [b.lon, b.lat] },
  // Missing heights stay out of the properties, so `typeof` tells them apart.
  properties: { id: b.id, ...(b.waveHeight != null && { wave: b.waveHeight }) },
});

const dot = (id: string, source: string): LayerSpecification => ({
  id,
  type: "circle",
  source,
  paint: {
    "circle-radius": RADIUS,
    "circle-color": WAVE_COLOR,
    "circle-stroke-color": "rgba(0,0,0,0.8)",
    "circle-stroke-width": 1.25,
  },
});

/** One dot per station, biggest waves on top. */
export const buoyLayers = (): LayerSpecification[] => [{ ...dot("buoy-dot", BUOYS_SRC), layout: { "circle-sort-key": ["coalesce", ["get", "wave"], -1] } } as LayerSpecification];

/** The open station: its dot with a white ring just outside it. */
export const buoySelectedLayers = (): LayerSpecification[] => [
  {
    id: "buoy-selected-ring",
    type: "circle",
    source: BUOY_SELECTED_SRC,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 8, 8, 11, 12, 13],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  },
  dot("buoy-selected-dot", BUOY_SELECTED_SRC),
];

/** A grid cell's arrow, pointing where its waves are heading (the forecast gives where they come from). */
export const waveArrowFeature = (lon: number, lat: number, fromDeg: number): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { toward: (fromDeg + 180) % 360 },
});

export const waveArrowLayers = (): LayerSpecification[] => [
  {
    id: "wave-arrows",
    type: "symbol",
    source: WAVE_ARROWS_SRC,
    layout: {
      "icon-image": WAVE_ARROW_ICON,
      "icon-rotate": ["get", "toward"],
      "icon-rotation-alignment": "map",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 8, 1],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": 0.85 },
  },
];
