import { describe, expect, it } from "vitest";
import { SATELLITE_MAP_SOURCE, satelliteMapPlan } from "./satellite-map";

// The start of CARTO's dark-matter style (positron has the same layers), then ours.
const CARTO = [
  ["background", "background"],
  ["landcover", "fill"],
  ["park_national_park", "fill"],
  ["landuse", "fill"],
  ["waterway", "line"],
  ["boundary_state", "line"],
  ["water", "fill"],
  ["road_mot_fill_noramp", "line"],
  ["building", "fill"],
  ["building-top", "fill"],
  ["boundary_country_inner", "line"],
  ["place_city_r6", "symbol"],
] as const;
const OURS = [
  ["slot-base", "background"],
  ["slot-satellite", "background"],
  ["sat-1760000000000", "raster"],
  ["plg-abc-true-color", "raster"],
  ["radar-0", "raster"],
] as const;
const layers = [...CARTO, ...OURS].map(([id, type]) => ({ id, type }));
const basemap = new Set(CARTO.map(([id]) => id));

describe("satelliteMapPlan", () => {
  it("goes just above the background and hides the basemap's area fills", () => {
    const plan = satelliteMapPlan(layers, basemap);
    expect(plan.before).toBe("landcover");
    expect(plan.hide).toEqual(["landcover", "park_national_park", "landuse", "water", "building", "building-top"]);
  });

  it("never touches our layers (GOES, plugins, radar) or the basemap's lines and labels", () => {
    const { hide } = satelliteMapPlan(layers, basemap);
    for (const [id] of OURS) expect(hide).not.toContain(id);
    for (const id of ["waterway", "boundary_state", "road_mot_fill_noramp", "boundary_country_inner", "place_city_r6"]) expect(hide).not.toContain(id);
  });

  it("copes with a basemap that's only a background", () => {
    expect(satelliteMapPlan([{ id: "bg", type: "background" }, { id: "slot-base", type: "background" }], new Set(["bg"]))).toEqual({ before: undefined, hide: [] });
  });
});

describe("SATELLITE_MAP_SOURCE", () => {
  it("is the CC BY 2016 mosaic (later years are non-commercial), attributed", () => {
    const [t] = SATELLITE_MAP_SOURCE.tiles;
    expect(t).toMatch(/^https:\/\/tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless_3857\/default\/g\/\{z\}\/\{y\}\/\{x\}\.jpg$/);
    expect(SATELLITE_MAP_SOURCE.attribution).toMatch(/EOX.*Copernicus Sentinel data 2016.*CC BY 4\.0/);
  });
});
