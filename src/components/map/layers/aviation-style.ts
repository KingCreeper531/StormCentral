import type { Feature } from "geojson";
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import {
  CATEGORY_COLORS,
  HAZARD_COLORS,
  UNKNOWN_CATEGORY_COLOR,
  type AdvisoryHazard,
  type AirportRow,
  type AviationAdvisory,
  type FlightCategory,
} from "@/lib/aviation";

/** Map sources: the airports, the open one on its own, the advisories and the open one's outline. */
export const AIRPORTS_SRC = "aviation-airports";
export const AIRPORT_SELECTED_SRC = "aviation-airport-selected";
export const ADVISORIES_SRC = "aviation-advisories";
export const ADVISORY_SELECTED_SRC = "aviation-advisory-selected";

/** Layers a tap on an airport or an advisory lands on. */
export const AIRPORT_HIT_LAYERS = ["aviation-airport-dot", "aviation-airport-selected-dot"];
export const ADVISORY_HIT_LAYERS = ["aviation-advisory-fill", "aviation-advisory-selected-line"];

const CATEGORY_COLOR = [
  "match",
  ["get", "cat"],
  ...(Object.keys(CATEGORY_COLORS) as FlightCategory[]).flatMap((c) => [c, CATEGORY_COLORS[c]]),
  UNKNOWN_CATEGORY_COLOR,
] as unknown as ExpressionSpecification;
const HAZARD_COLOR = [
  "match",
  ["get", "hazard"],
  ...(Object.keys(HAZARD_COLORS) as AdvisoryHazard[]).flatMap((h) => [h, HAZARD_COLORS[h]]),
  HAZARD_COLORS.other,
] as unknown as ExpressionSpecification;
const DOT_RADIUS: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 3, 2.5, 6, 4, 9, 5.5, 13, 7];
/** Ids label the dots from here, where airports stop crowding each other. */
const LABEL_ZOOM = 7.5;
const SIGMET: ExpressionSpecification = ["in", ["get", "kind"], ["literal", ["sigmet", "convective"]]];

export const airportFeature = ([id, lat, lon, cat]: AirportRow): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { id, cat: cat ?? "" },
});

export const advisoryFeature = (a: AviationAdvisory): Feature => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [a.ring] },
  properties: { id: a.id, kind: a.kind, hazard: a.hazard },
});

/** A dot per airport in its flight category's colour, dark-rimmed so it reads on radar; ids once zoomed in. */
export const airportLayers = (font: string[]): LayerSpecification[] => [
  {
    id: "aviation-airport-dot",
    type: "circle",
    source: AIRPORTS_SRC,
    paint: {
      "circle-radius": DOT_RADIUS,
      "circle-color": CATEGORY_COLOR,
      "circle-stroke-color": "rgba(0,0,0,0.85)",
      "circle-stroke-width": 1,
    },
  },
  {
    id: "aviation-airport-label",
    type: "symbol",
    source: AIRPORTS_SRC,
    minzoom: LABEL_ZOOM,
    layout: {
      "text-field": ["get", "id"],
      "text-font": font,
      "text-size": 10,
      "text-anchor": "left",
      "text-offset": [0.8, 0],
      "text-optional": true,
    },
    paint: { "text-color": CATEGORY_COLOR, "text-halo-color": "#000000", "text-halo-width": 1.2 },
  },
];

/** The open airport: its dot, larger, ringed in white, above the rest. */
export const airportSelectedLayers = (): LayerSpecification[] => [
  {
    id: "aviation-airport-selected-dot",
    type: "circle",
    source: AIRPORT_SELECTED_SRC,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 9, 7.5, 13, 9],
      "circle-color": CATEGORY_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  },
];

/**
 * SIGMETs solid, AIRMETs and G-AIRMETs dashed and thinner, over a faint wash
 * of the hazard's colour (which is also what a tap lands on).
 */
export const advisoryLayers = (): LayerSpecification[] => [
  {
    id: "aviation-advisory-fill",
    type: "fill",
    source: ADVISORIES_SRC,
    paint: { "fill-color": HAZARD_COLOR, "fill-opacity": ["case", SIGMET, 0.1, 0.05] },
  },
  {
    id: "aviation-advisory-sigmet-line",
    type: "line",
    source: ADVISORIES_SRC,
    filter: SIGMET,
    layout: { "line-join": "round" },
    paint: { "line-color": HAZARD_COLOR, "line-width": 2 },
  },
  {
    id: "aviation-advisory-airmet-line",
    type: "line",
    source: ADVISORIES_SRC,
    filter: ["!", SIGMET],
    layout: { "line-join": "round" },
    paint: { "line-color": HAZARD_COLOR, "line-width": 1.4, "line-dasharray": [3, 2] },
  },
];

/** The open advisory: a white outline over its own. */
export const advisorySelectedLayers = (): LayerSpecification[] => [
  {
    id: "aviation-advisory-selected-line",
    type: "line",
    source: ADVISORY_SELECTED_SRC,
    layout: { "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 3 },
  },
];
