import type { Feature } from "geojson";
import type { ExpressionSpecification, GeoJSONSourceSpecification, LayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { WEBCAM_SOURCES, WEBCAM_SOURCE_IDS, type Webcam } from "@/lib/webcams";
import { webcamIconId } from "./webcam-icon";

/** Map sources: every camera (clustered), and the open one on its own. */
export const WEBCAMS_SRC = "webcams";
export const WEBCAM_SELECTED_SRC = "webcam-selected";

/** Badge image id → colour, one per colour (sources of the same kind share one). */
export const WEBCAM_ICONS = new Map(WEBCAM_SOURCE_IDS.map((s) => [webcamIconId(WEBCAM_SOURCES[s].color), WEBCAM_SOURCES[s].color]));

/** Marker colour by source (lib/webcams WEBCAM_SOURCES). */
const COLOR = ["match", ["get", "source"], ...WEBCAM_SOURCE_IDS.flatMap((s) => [s, WEBCAM_SOURCES[s].color]), "#9aa0a6"] as unknown as ExpressionSpecification;
const ICON = ["match", ["get", "source"], ...WEBCAM_SOURCE_IDS.flatMap((s) => [s, webcamIconId(WEBCAM_SOURCES[s].color)]), webcamIconId(WEBCAM_SOURCES.caltrans.color)] as unknown as ExpressionSpecification;
const ICON_SIZE: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 4, 0.65, 12, 0.85, 15, 1];
const NAME_ZOOM = 12;
const CLUSTERED: ExpressionSpecification = ["has", "point_count"];

/** Cameras closer than 36 px merge into a count bubble, up to zoom 11; past it every camera shows. */
export const WEBCAM_CLUSTER_MAX_ZOOM = 11;
export const WEBCAM_CLUSTERING: Omit<GeoJSONSourceSpecification, "type" | "data"> = { cluster: true, clusterRadius: 36, clusterMaxZoom: WEBCAM_CLUSTER_MAX_ZOOM };

export const webcamFeature = (c: Webcam): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [c.lon, c.lat] },
  properties: { id: c.id, source: c.source, name: c.name },
});

/** The camera badge and, once zoomed in, its name (dropped where it doesn't fit; the badge never is). */
const badgeLayout = (font: string[]): SymbolLayerSpecification["layout"] => ({
  "icon-image": ICON,
  "icon-size": ICON_SIZE,
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
  "text-field": ["step", ["zoom"], "", NAME_ZOOM, ["get", "name"]],
  "text-font": font,
  "text-size": 11,
  "text-anchor": "left",
  "text-offset": [1.3, 0],
  "text-max-width": 14,
  "text-optional": true,
});
const badgePaint: SymbolLayerSpecification["paint"] = { "text-color": COLOR, "text-halo-color": "#000000", "text-halo-width": 1.2 };

/** Count bubbles and single-camera badges, on the clustered source. */
export const webcamLayers = (font: string[]): LayerSpecification[] => [
  {
    id: "webcam-cluster",
    type: "circle",
    source: WEBCAMS_SRC,
    filter: CLUSTERED,
    paint: {
      // Styled like the camera badges (most cameras are traffic ones): amber, dark rim, dark count.
      "circle-radius": ["step", ["get", "point_count"], 11, 10, 13, 100, 16, 1000, 19],
      "circle-color": WEBCAM_SOURCES.caltrans.color,
      "circle-stroke-color": "rgba(0,0,0,0.85)",
      "circle-stroke-width": 1.5,
    },
  },
  {
    id: "webcam-cluster-count",
    type: "symbol",
    source: WEBCAMS_SRC,
    filter: CLUSTERED,
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": font,
      "text-size": 11,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#0b0f14" },
  },
  { id: "webcam-icon", type: "symbol", source: WEBCAMS_SRC, filter: ["!", CLUSTERED], layout: badgeLayout(font), paint: badgePaint },
];

/** The open camera: its badge with a white ring just outside it, on its own source so a bubble never hides it. */
export const webcamSelectedLayers = (font: string[]): LayerSpecification[] => [
  {
    id: "webcam-selected-ring",
    type: "circle",
    source: WEBCAM_SELECTED_SRC,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 12.5, 15, 14],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  },
  { id: "webcam-selected-icon", type: "symbol", source: WEBCAM_SELECTED_SRC, layout: badgeLayout(font), paint: badgePaint },
];
