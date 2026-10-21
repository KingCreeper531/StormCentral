import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { PATH_SRC, pathCalloutId, stormPathLayers } from "./storm-path-style";

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

describe("storm path layers", () => {
  it("are valid MapLibre style (an invalid layer is silently left off the map)", () => {
    const style: StyleSpecification = {
      version: 8,
      glyphs: "https://example.com/{fontstack}/{range}.pbf",
      sources: { [PATH_SRC]: { type: "geojson", data: empty } },
      layers: stormPathLayers(["Noto Sans Regular"]),
    };
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  it("names one callout image per warning colour", () => {
    expect(pathCalloutId("#FF0000")).toBe("path-callout-FF0000");
    expect(pathCalloutId("#ff0000")).not.toBe(pathCalloutId("#FFA500"));
  });
});
