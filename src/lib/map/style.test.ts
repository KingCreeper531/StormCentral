import { describe, expect, it } from "vitest";
import {
  basemapOps,
  basemapUrl,
  countyLineColor,
  DARK_LAND,
  DARK_WATER,
  DEFAULT_MAP_STYLE,
  filterValues,
  insertionPoints,
  isDefaultStyle,
  layerGroup,
  normalizeMapStyle,
  resolveBasemap,
  scaleSize,
  type BaseLayer,
  type MapStyle,
} from "./style";

// A slice of CARTO's dark-matter style as it loads (positron and voyager share the layers).
const CARTO: BaseLayer[] = [
  { id: "background", type: "background", paint: { "background-color": "#0e0e0e" } },
  { id: "landcover", type: "fill", "source-layer": "landcover", paint: { "fill-color": "#111" } },
  { id: "park_national_park", type: "fill", "source-layer": "park", minzoom: 9, filter: ["all", ["==", "class", "national_park"]] },
  { id: "waterway", type: "line", "source-layer": "waterway", paint: { "line-color": "#14141a" } },
  {
    id: "boundary_county",
    type: "line",
    "source-layer": "boundary",
    minzoom: 9,
    filter: ["all", ["==", "admin_level", 6], ["==", "maritime", 0]],
    paint: { "line-color": "#222", "line-width": { base: 1, stops: [[4, 0.4], [10, 1]] } },
  },
  { id: "boundary_state", type: "line", "source-layer": "boundary", minzoom: 4, filter: ["all", ["==", "admin_level", 4], ["==", "maritime", 0]], paint: { "line-color": "#333" } },
  { id: "water", type: "fill", "source-layer": "water", filter: ["all", ["==", "$type", "Polygon"]], paint: { "fill-color": "#1b1b1d" } },
  { id: "road_mot_case_noramp", type: "line", "source-layer": "transportation", filter: ["all", ["==", "class", "motorway"], ["!=", "ramp", 1]], paint: { "line-color": "#000" } },
  { id: "road_mot_fill_noramp", type: "line", "source-layer": "transportation", filter: ["all", ["==", "class", "motorway"], ["!=", "ramp", 1]], paint: { "line-color": "#444" } },
  { id: "road_sec_fill_noramp", type: "line", "source-layer": "transportation", filter: ["all", ["in", "class", "secondary", "tertiary"], ["!has", "brunnel"]], paint: { "line-color": "#2a2a2a" } },
  { id: "rail", type: "line", "source-layer": "transportation", filter: ["all", ["==", "class", "rail"]] },
  { id: "building", type: "fill", "source-layer": "building" },
  { id: "boundary_country_inner", type: "line", "source-layer": "boundary", filter: ["all", ["==", "admin_level", 2], ["==", "maritime", 0]], paint: { "line-color": "#555", "line-width": 1.2 } },
  { id: "watername_lake", type: "symbol", "source-layer": "water_name", layout: { "text-size": 12 } },
  { id: "place_city_r6", type: "symbol", "source-layer": "place", layout: { "text-size": { stops: [[8, 12], [15, 20]] } }, paint: { "text-color": "#888" } },
  { id: "roadname_major", type: "symbol", "source-layer": "transportation_name" },
  { id: "poi_park", type: "symbol", "source-layer": "poi" },
];

const style = (patch: Partial<MapStyle> = {}) => normalizeMapStyle({ ...DEFAULT_MAP_STYLE, ...patch });
const op = (ops: ReturnType<typeof basemapOps>, id: string) => ops.find((o) => o.id === id);

describe("normalizeMapStyle", () => {
  it("fills in defaults and keeps a good style as it is", () => {
    expect(normalizeMapStyle(undefined)).toEqual(DEFAULT_MAP_STYLE);
    const s = style({ basemap: "streets", hillshade: 0.4, roads: "major", water: "#123abc" });
    expect(normalizeMapStyle(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("clamps numbers and drops anything that isn't a known value or a #rrggbb colour", () => {
    const s = normalizeMapStyle({
      basemap: "neon",
      hillshade: 7,
      exaggeration: -1,
      labelSize: "big",
      roads: "some",
      water: "red",
      land: "#ABCDEF",
      states: { show: "yes", color: "url(x)", width: 99 },
      counties: { show: "everywhere", width: 0.1 },
    });
    expect(s.basemap).toBe("auto");
    expect(s.hillshade).toBe(1);
    expect(s.exaggeration).toBe(1);
    expect(s.labelSize).toBe(1);
    expect(s.roads).toBe("all");
    expect(s.water).toBeNull();
    expect(s.land).toBe("#abcdef");
    expect(s.states).toEqual({ show: true, color: null, width: 3 });
    expect(s.counties).toEqual({ show: "near", color: null, width: 0.5 });
  });

  it("knows the default", () => {
    expect(isDefaultStyle(DEFAULT_MAP_STYLE)).toBe(true);
    expect(isDefaultStyle(style({ buildings: false }))).toBe(false);
  });
});

describe("basemaps", () => {
  it("follows the theme on auto", () => {
    expect(resolveBasemap("auto", "light")).toBe("light");
    expect(resolveBasemap("auto", "dark")).toBe("dark");
    expect(resolveBasemap("streets", "dark")).toBe("streets");
  });

  it("uses CARTO without a key and MapTiler with one", () => {
    expect(basemapUrl("dark")).toBe("https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json");
    expect(basemapUrl("light")).toBe("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json");
    expect(basemapUrl("streets")).toBe("https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json");
    expect(basemapUrl("dark", "k")).toBe("https://api.maptiler.com/maps/dataviz-dark/style.json?key=k");
    expect(basemapUrl("streets", "k")).toBe("https://api.maptiler.com/maps/streets-v2/style.json?key=k");
  });
});

describe("filterValues", () => {
  it("reads legacy filters", () => {
    expect(filterValues(["all", ["==", "admin_level", 4], ["==", "maritime", 0]], "admin_level")).toEqual([4]);
    expect(filterValues(["all", ["in", "class", "secondary", "tertiary"], ["!has", "brunnel"]], "class")).toEqual(["secondary", "tertiary"]);
    expect(filterValues(["all", ["<=", "admin_level", 4]], "admin_level")).toEqual([4]);
  });

  it("reads expression filters, including match and literal lists", () => {
    expect(filterValues(["==", ["get", "admin_level"], 2], "admin_level")).toEqual([2]);
    expect(filterValues(["in", ["get", "class"], ["literal", ["motorway", "trunk"]]], "class")).toEqual(["motorway", "trunk"]);
    expect(filterValues(["match", ["get", "class"], ["primary", "secondary"], true, "minor", false, false], "class")).toEqual(["primary", "secondary"]);
  });

  it("ignores other keys and odd input", () => {
    expect(filterValues(["==", "class", "rail"], "admin_level")).toEqual([]);
    expect(filterValues(undefined, "class")).toEqual([]);
  });
});

describe("layerGroup", () => {
  it("sorts CARTO's layers by what they draw", () => {
    const groups = Object.fromEntries(CARTO.map((l) => [l.id, layerGroup(l)]));
    expect(groups).toEqual({
      background: "land",
      landcover: "landcover",
      park_national_park: "landcover",
      waterway: "waterways",
      boundary_county: "counties",
      boundary_state: "states",
      water: "water",
      road_mot_case_noramp: "roadsMajor",
      road_mot_fill_noramp: "roadsMajor",
      road_sec_fill_noramp: "roadsMinor",
      rail: "roadsMinor",
      building: "buildings",
      boundary_country_inner: "countries",
      watername_lake: "waterLabels",
      place_city_r6: "placeLabels",
      roadname_major: "roadLabels",
      poi_park: "poiLabels",
    });
  });
});

describe("scaleSize", () => {
  it("scales numbers, legacy zoom functions and zoom curves", () => {
    expect(scaleSize(1.2, 2, 1)).toBe(2.4);
    expect(scaleSize({ base: 1.4, stops: [[4, 0.4], [10, 1]] }, 2, 1)).toEqual({ base: 1.4, stops: [[4, 0.8], [10, 2]] });
    expect(scaleSize(["interpolate", ["linear"], ["zoom"], 4, 1, 10, 3], 1.5, 1)).toEqual(["interpolate", ["linear"], ["zoom"], 4, 1.5, 10, 4.5]);
    expect(scaleSize(["step", ["zoom"], 1, 8, 2], 2, 1)).toEqual(["step", ["zoom"], 2, 8, 4]);
  });

  it("uses the default for an unset property and multiplies other expressions", () => {
    expect(scaleSize(undefined, 1.5, 16)).toBe(24);
    expect(scaleSize(["get", "size"], 2, 1)).toEqual(["*", ["get", "size"], 2]);
  });

  it("leaves everything alone at ×1", () => {
    const v = { stops: [[1, 2]] };
    expect(scaleSize(v, 1, 1)).toBe(v);
    expect(scaleSize(undefined, 1, 16)).toBeUndefined();
  });
});

describe("basemapOps", () => {
  it("gives the dark basemap its near-black land and water, and the light one its own colours", () => {
    const dark = basemapOps(CARTO, style(), { dark: true, satellite: false });
    expect(op(dark, "background")!.paint["background-color"]).toBe(DARK_LAND);
    expect(op(dark, "water")!.paint["fill-color"]).toBe(DARK_WATER);
    const light = basemapOps(CARTO, style(), { dark: false, satellite: false });
    expect(op(light, "background")!.paint["background-color"]).toBe("#0e0e0e");
    expect(op(light, "water")!.paint["fill-color"]).toBe("#1b1b1d");
  });

  it("uses the person's colours over both, rivers included", () => {
    const ops = basemapOps(CARTO, style({ water: "#0b1d33", land: "#111827" }), { dark: true, satellite: false });
    expect(op(ops, "water")!.paint["fill-color"]).toBe("#0b1d33");
    expect(op(ops, "waterway")!.paint["line-color"]).toBe("#0b1d33");
    expect(op(ops, "background")!.paint["background-color"]).toBe("#111827");
  });

  it("restyles borders and keeps the basemap's own where nothing is chosen", () => {
    const ops = basemapOps(CARTO, style({ states: { show: true, color: "#ffffff", width: 2 } }), { dark: false, satellite: false });
    expect(op(ops, "boundary_state")!.paint).toEqual({ "line-color": "#ffffff", "line-width": 2 });
    expect(op(ops, "boundary_county")!.paint).toEqual({ "line-color": "#222", "line-width": { base: 1, stops: [[4, 0.4], [10, 1]] } });
    expect(op(ops, "boundary_country_inner")!.paint["line-width"]).toBe(1.2);
  });

  it("hides what's switched off and shows it again from the originals", () => {
    const off = basemapOps(CARTO, style({ roads: "major", counties: { show: "off", color: null, width: 1 }, buildings: false, poiLabels: false }), { dark: false, satellite: false });
    const vis = (ops: ReturnType<typeof basemapOps>, id: string) => op(ops, id)!.layout.visibility;
    expect(vis(off, "road_mot_fill_noramp")).toBe("visible");
    expect(vis(off, "road_sec_fill_noramp")).toBe("none");
    expect(vis(off, "rail")).toBe("none");
    expect(vis(off, "boundary_county")).toBe("none");
    expect(vis(off, "building")).toBe("none");
    expect(vis(off, "poi_park")).toBe("none");
    const on = basemapOps(CARTO, style(), { dark: false, satellite: false });
    for (const id of ["road_sec_fill_noramp", "rail", "boundary_county", "building", "poi_park"]) expect(vis(on, id)).toBe("visible");
    expect(vis(basemapOps(CARTO, style({ roads: "off" }), { dark: false, satellite: false }), "road_mot_fill_noramp")).toBe("none");
  });

  it("colours road fills but not their casings", () => {
    const ops = basemapOps(CARTO, style({ roadColor: "#facc15" }), { dark: false, satellite: false });
    expect(op(ops, "road_mot_fill_noramp")!.paint["line-color"]).toBe("#facc15");
    expect(op(ops, "road_mot_case_noramp")!.paint["line-color"]).toBeUndefined();
  });

  it("scales every label", () => {
    const ops = basemapOps(CARTO, style({ labelSize: 1.5 }), { dark: false, satellite: false });
    expect(op(ops, "watername_lake")!.layout["text-size"]).toBe(18);
    expect(op(ops, "place_city_r6")!.layout["text-size"]).toEqual({ stops: [[8, 18], [15, 30]] });
    expect(op(ops, "roadname_major")!.layout["text-size"]).toBe(24);
  });

  it("under the satellite map, hides the area fills and turns labels white, then puts both back", () => {
    const sat = basemapOps(CARTO, style(), { dark: true, satellite: true });
    for (const id of ["landcover", "park_national_park", "water", "building"]) expect(op(sat, id)!.layout.visibility).toBe("none");
    for (const id of ["waterway", "boundary_state", "road_mot_fill_noramp"]) expect(op(sat, id)!.layout.visibility).toBe("visible");
    expect(op(sat, "place_city_r6")!.paint["text-color"]).toBe("#ffffff");
    const plain = basemapOps(CARTO, style(), { dark: true, satellite: false });
    expect(op(plain, "water")!.layout.visibility).toBe("visible");
    expect(op(plain, "place_city_r6")!.paint["text-color"]).toBe("#888");
    expect(op(plain, "place_city_r6")!.paint["text-halo-width"]).toBeUndefined();
  });

  it("keeps a layer the basemap hides itself hidden", () => {
    const layers: BaseLayer[] = [{ id: "x", type: "line", "source-layer": "boundary", filter: ["==", "admin_level", 4], layout: { visibility: "none" } }];
    expect(basemapOps(layers, style(), { dark: false, satellite: false })[0]!.layout.visibility).toBe("none");
  });
});

describe("insertionPoints and county lines", () => {
  it("puts shading under the first basemap line and our counties with the borders, handing over at the basemap's county zoom", () => {
    expect(insertionPoints(CARTO)).toEqual({ hillshade: "waterway", counties: "boundary_state", countyMinzoom: 9 });
    expect(insertionPoints([{ id: "bg", type: "background" }])).toEqual({ hillshade: undefined, counties: undefined, countyMinzoom: 9 });
  });

  it("draws our county lines in the person's colour, else the basemap's", () => {
    expect(countyLineColor(CARTO, style(), true)).toBe("#222");
    expect(countyLineColor(CARTO, style({ counties: { show: "always", color: "#facc15", width: 1 } }), true)).toBe("#facc15");
    expect(countyLineColor([], style(), false)).toBe("#a3acb9");
  });
});
