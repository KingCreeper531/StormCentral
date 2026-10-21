import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { WEBCAM_SOURCES } from "@/lib/webcams";
import { webcamIconId } from "./webcam-icon";
import { WEBCAM_CLUSTERING, WEBCAM_ICONS, WEBCAM_SELECTED_SRC, webcamLayers, WEBCAMS_SRC, webcamSelectedLayers } from "./webcams-style";

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

describe("camera layers", () => {
  it("are valid MapLibre style (an invalid layer is silently left off the map)", () => {
    // The camera dots once had "zoom" nested inside a "case", which MapLibre rejects, so no camera showed.
    const style: StyleSpecification = {
      version: 8,
      glyphs: "https://example.com/{fontstack}/{range}.pbf",
      sources: {
        [WEBCAMS_SRC]: { type: "geojson", data: empty, ...WEBCAM_CLUSTERING },
        [WEBCAM_SELECTED_SRC]: { type: "geojson", data: empty },
      },
      layers: [...webcamLayers(["Noto Sans Regular"]), ...webcamSelectedLayers(["Noto Sans Regular"])],
    };
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  it("have a badge image for every camera colour", () => {
    for (const { color } of Object.values(WEBCAM_SOURCES)) expect(WEBCAM_ICONS.get(webcamIconId(color))).toBe(color);
  });
});
