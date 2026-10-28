import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import type { Buoy } from "@/lib/feeds/buoys";
import { BUOY_SELECTED_SRC, buoyFeature, buoyLayers, BUOYS_SRC, buoySelectedLayers, WAVE_ARROWS_SRC, waveArrowFeature, waveArrowLayers } from "./marine-style";

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
const buoy: Buoy = {
  id: "41001",
  name: "East Hatteras",
  kind: "buoy",
  lat: 34.724,
  lon: -72.317,
  time: "2026-10-28T11:50:00.000Z",
  waveHeight: 1.6,
  dominantPeriod: 8,
  waveDir: 110,
  windDir: 220,
  windSpeed: 7,
  gust: 9,
  pressure: 1016.5,
  airTemp: 21.2,
  waterTemp: 24.1,
};

describe("marine layers", () => {
  it("are valid MapLibre style (an invalid layer is silently left off the map)", () => {
    const style: StyleSpecification = {
      version: 8,
      glyphs: "https://example.com/{fontstack}/{range}.pbf",
      sources: {
        [BUOYS_SRC]: { type: "geojson", data: empty },
        [BUOY_SELECTED_SRC]: { type: "geojson", data: empty },
        [WAVE_ARROWS_SRC]: { type: "geojson", data: empty },
      },
      layers: [...buoyLayers(), ...buoySelectedLayers(), ...waveArrowLayers()],
    };
    expect(validateStyleMin(style).map((e) => e.message)).toEqual([]);
  });

  it("leave a missing wave height out of a buoy's properties, so it draws grey", () => {
    expect(buoyFeature(buoy).properties).toEqual({ id: "41001", wave: 1.6 });
    expect(buoyFeature({ ...buoy, waveHeight: null }).properties).toEqual({ id: "41001" });
  });

  it("point wave arrows where the waves are heading", () => {
    expect(waveArrowFeature(-70, 35, 110).properties).toEqual({ toward: 290 });
    expect(waveArrowFeature(-70, 35, 270).properties).toEqual({ toward: 90 });
  });
});
