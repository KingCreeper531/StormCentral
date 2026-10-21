import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

/** The map source for every warned storm's path, cone, time marks and town callouts. */
export const PATH_SRC = "storm-paths";

/** Map image id of the callout bubble for a warning colour. */
export const pathCalloutId = (color: string) => `path-callout-${color.replace("#", "")}`;

const kind = (k: string): ExpressionSpecification => ["==", ["get", "kind"], k];
const COLOR: ExpressionSpecification = ["get", "color"];
/** The selected warning's path and every tornado's stand out; the rest stay quiet. */
const FOCUS: ExpressionSpecification = ["==", ["get", "focus"], true];

/**
 * Bottom to top: the cone, its edge, the centre line, the time marks and their
 * clock times, the storm now, then each town in the path with a callout
 * ("Moore / 6:12 PM"). Callouts give way to each other, bigger towns first.
 */
export const stormPathLayers = (font: string[]): LayerSpecification[] => [
  {
    id: "path-cone",
    type: "fill",
    source: PATH_SRC,
    filter: kind("cone"),
    paint: { "fill-color": COLOR, "fill-opacity": ["case", FOCUS, 0.2, 0.08] },
  },
  {
    id: "path-cone-edge",
    type: "line",
    source: PATH_SRC,
    filter: kind("cone"),
    paint: { "line-color": COLOR, "line-width": 1, "line-opacity": ["case", FOCUS, 0.7, 0.35] },
  },
  {
    id: "path-line",
    type: "line",
    source: PATH_SRC,
    filter: kind("line"),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": COLOR, "line-width": ["case", FOCUS, 2.5, 1.5], "line-opacity": ["case", FOCUS, 1, 0.7] },
  },
  {
    id: "path-marks",
    type: "circle",
    source: PATH_SRC,
    filter: kind("mark"),
    paint: { "circle-radius": 3.5, "circle-color": "#0b0f14", "circle-stroke-color": COLOR, "circle-stroke-width": 1.5 },
  },
  {
    id: "path-mark-times",
    type: "symbol",
    source: PATH_SRC,
    filter: ["all", kind("mark"), FOCUS],
    minzoom: 6.5,
    layout: {
      "text-field": ["get", "label"],
      "text-font": font,
      "text-size": 10.5,
      "text-anchor": "top",
      "text-offset": [0, 0.8],
      "text-optional": true,
    },
    paint: { "text-color": "#ececed", "text-halo-color": "#000000", "text-halo-width": 1.2 },
  },
  {
    id: "path-now",
    type: "circle",
    source: PATH_SRC,
    filter: kind("now"),
    paint: { "circle-radius": ["case", FOCUS, 6, 4.5], "circle-color": COLOR, "circle-stroke-color": "#000000", "circle-stroke-width": 1.5 },
  },
  {
    id: "path-town-dots",
    type: "circle",
    source: PATH_SRC,
    filter: kind("town"),
    paint: { "circle-radius": 3, "circle-color": "#ffffff", "circle-stroke-color": COLOR, "circle-stroke-width": 1.5 },
  },
  {
    id: "path-callouts",
    type: "symbol",
    source: PATH_SRC,
    filter: kind("town"),
    minzoom: 6,
    layout: {
      "symbol-sort-key": ["get", "rank"],
      "text-field": ["format", ["get", "name"], {}, "\n", {}, ["get", "time"], { "font-scale": 0.88 }],
      "text-font": font,
      "text-size": 11.5,
      "text-line-height": 1.15,
      "text-anchor": "bottom",
      "text-offset": [0, -0.9],
      "text-max-width": 12,
      "icon-image": ["get", "icon"],
      "icon-text-fit": "both",
      "icon-text-fit-padding": [3, 7, 3, 7],
    },
    paint: { "text-color": "#f4f6fb" },
  },
];
