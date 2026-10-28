import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
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

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
const layers = [...advisoryLayers(), ...advisorySelectedLayers(), ...airportLayers(["Noto Sans Regular"]), ...airportSelectedLayers()];

describe("aviation layers", () => {
  it("are valid MapLibre style (an invalid layer is silently left off the map)", () => {
    const style: StyleSpecification = {
      version: 8,
      glyphs: "https://example.com/{fontstack}/{range}.pbf",
      sources: {
        [AIRPORTS_SRC]: { type: "geojson", data: empty },
        [AIRPORT_SELECTED_SRC]: { type: "geojson", data: empty },
        [ADVISORIES_SRC]: { type: "geojson", data: empty },
        [ADVISORY_SELECTED_SRC]: { type: "geojson", data: empty },
      },
      layers,
    };
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  it("can be tapped where the layer's taps are listened for", () => {
    const ids = new Set(layers.map((l) => l.id));
    for (const id of [...AIRPORT_HIT_LAYERS, ...ADVISORY_HIT_LAYERS]) expect(ids.has(id), id).toBe(true);
  });

  it("carry what the styles read", () => {
    expect(airportFeature(["KOKC", 35.39, -97.6, null]).properties).toEqual({ id: "KOKC", cat: "" });
    const f = advisoryFeature({
      id: "a",
      kind: "convective",
      hazard: "convective",
      from: "",
      to: "",
      baseFt: null,
      topFt: null,
      text: "",
      ring: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    });
    expect(f.properties).toEqual({ id: "a", kind: "convective", hazard: "convective" });
    expect(f.geometry.type).toBe("Polygon");
  });
});
