import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tropicalFeed } from "./tropical";
import {
  intensityLabel,
  lineThrough,
  mergeLines,
  mergePolygons,
  parseCoordinate,
  parseCurrentStorms,
  parseForecastPoints,
  parseLayerMap,
  saffirSimpson,
  stageOf,
  stormFeatures,
} from "./tropical-parse";
import { setUpstreamTransport } from "./upstream";

/** A CurrentStorms.json entry as NHC serves it (trimmed of the GIS/KMZ links). */
const MILTON = {
  id: "al142024",
  binNumber: "AT4",
  name: "Milton",
  classification: "HU",
  intensity: "155",
  pressure: "905",
  latitude: "21.8N",
  longitude: "91.1W",
  latitudeNumeric: 21.8,
  longitudeNumeric: -91.1,
  movementDir: 90,
  movementSpeed: 8,
  lastUpdate: "2024-10-08T03:00:00.000Z",
  publicAdvisory: {
    advNum: "13",
    issuance: "2024-10-08T03:00:00.000Z",
    fileUpdateTime: "2024-10-08T02:54:31.623Z",
    url: "https://www.nhc.noaa.gov/text/refresh/MIATCPAT4+shtml/080254.shtml",
  },
  forecastGraphics: { url: "https://www.nhc.noaa.gov/graphics_at4.shtml?start#contents" },
  trackCone: { kmzFile: "https://www.nhc.noaa.gov/storm_graphics/api/AL142024_013adv_CONE.kmz" },
};

const OSCAR = {
  id: "al162024",
  binNumber: "AT1",
  name: "OSCAR",
  classification: "PTC",
  intensity: "40",
  pressure: "1004",
  latitude: "24.0N",
  longitude: "72.5W",
  latitudeNumeric: "24.0",
  longitudeNumeric: "-72.5",
  movementDir: "45",
  movementSpeed: "16",
  lastUpdate: "2024-10-23T15:00:00.000Z",
  publicAdvisory: { advNum: "15", issuance: "2024-10-23T15:00:00.000Z", url: "http://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/231451.shtml" },
};

describe("intensity", () => {
  it("bins wind into Saffir-Simpson categories", () => {
    expect([63, 64, 82, 83, 95, 96, 112, 113, 136, 137, null].map((w) => saffirSimpson(w))).toEqual([null, 1, 1, 2, 2, 3, 3, 4, 4, 5, null]);
  });

  it("reads classification codes, shapefile labels and descriptions", () => {
    expect(["HU", "TY", "M", "S", "D", "STS", "SD", "PTC", "Post-Tropical Cyclone", "Remnant Low", "PC", "??"].map(stageOf)).toEqual([
      "HU", "HU", "HU", "TS", "TD", "SS", "SD", "PT", "PT", "LO", "PC", null,
    ]);
    expect(intensityLabel("HU", 120)).toBe("H4");
    expect(intensityLabel("HU", null, 3)).toBe("H3");
    expect(intensityLabel(null, 50)).toBe("TS");
    expect(intensityLabel(null, 25)).toBe("TD");
    expect(intensityLabel("PT", 60)).toBe("PT");
    expect(intensityLabel(null, null)).toBeNull();
  });
});

describe("parseCoordinate", () => {
  it("prefers the numeric field and falls back to N/S/E/W text", () => {
    expect(parseCoordinate(-80.1, "80.1W", "lon")).toBe(-80.1);
    expect(parseCoordinate(undefined, "15.2S", "lat")).toBe(-15.2);
    expect(parseCoordinate("", "178.9E", "lon")).toBe(178.9);
    expect(parseCoordinate(null, "25.4 N", "lat")).toBe(25.4);
    // An unsigned numeric field is corrected by the hemisphere letter.
    expect(parseCoordinate(80.1, "80.1W", "lon")).toBe(-80.1);
    expect(parseCoordinate(null, "north", "lat")).toBeNull();
    expect(parseCoordinate(95, null, "lat")).toBeNull();
  });
});

describe("parseCurrentStorms", () => {
  it("returns an empty list when nothing is active, and null for an unknown document", () => {
    expect(parseCurrentStorms({ activeStorms: [] })).toEqual([]);
    expect(parseCurrentStorms(null)).toBeNull();
    expect(parseCurrentStorms({ storms: [] })).toBeNull();
  });

  it("parses a hurricane", () => {
    const [s] = parseCurrentStorms({ activeStorms: [MILTON] })!;
    expect(s).toMatchObject({
      id: "al142024",
      name: "Milton",
      classification: "HU",
      title: "Hurricane Milton",
      category: 5,
      label: "H5",
      windKt: 155,
      pressureMb: 905,
      lat: 21.8,
      lon: -91.1,
      movement: { towardDeg: 90, speedMph: 8 },
      advisoryUrl: "https://www.nhc.noaa.gov/text/refresh/MIATCPAT4+shtml/080254.shtml",
      updated: "2024-10-08T03:00:00.000Z",
      bin: "AT4",
      basin: "Atlantic",
      advisory: { number: "13", issued: "2024-10-08T03:00:00.000Z" },
      cone: null,
      track: null,
      forecast: [],
      pastTrack: null,
    });
  });

  it("parses a post-tropical cyclone sent as numeric strings", () => {
    const [s] = parseCurrentStorms({ activeStorms: [OSCAR] })!;
    expect(s).toMatchObject({
      name: "Oscar",
      title: "Post-Tropical Cyclone Oscar",
      category: null,
      label: "PT",
      windKt: 40,
      pressureMb: 1004,
      lat: 24,
      lon: -72.5,
      movement: { towardDeg: 45, speedMph: 16 },
      advisoryUrl: "https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/231451.shtml",
    });
  });

  it("falls back to lat/lon text, tolerates gaps and skips unusable entries", () => {
    const storms = parseCurrentStorms({
      activeStorms: [
        { id: "CP012026", binNumber: "cp1", name: "ONE-C", classification: "TD", intensity: "30", pressure: "", latitude: "12.5N", longitude: "178.9E", movementDir: "", movementSpeed: "0" },
        { id: "ep052026", name: "Erick", classification: "TS", latitude: "15.0N" },
        { name: "No id", latitudeNumeric: 10, longitudeNumeric: -50 },
        "junk",
      ],
    })!;
    expect(storms).toHaveLength(1);
    expect(storms[0]).toMatchObject({
      id: "cp012026",
      name: "One-C",
      title: "Tropical Depression One-C",
      label: "TD",
      lat: 12.5,
      lon: 178.9,
      pressureMb: null,
      movement: { towardDeg: null, speedMph: 0 },
      bin: "CP1",
      basin: "Central Pacific",
      advisoryUrl: null,
      updated: null,
    });
  });
});

describe("parseLayerMap", () => {
  it("maps layer names to per-bin ids without assuming them", () => {
    const map = parseLayerMap({
      currentVersion: 11.1,
      layers: [
        { id: 0, name: "Atlantic Tropical Weather Outlook", parentLayerId: -1, subLayerIds: [1] },
        { id: 1, name: "Two-Day Formation Areas", parentLayerId: 0 },
        { id: 5, name: "AT1", parentLayerId: -1, subLayerIds: [6, 7, 8, 9, 10, 11, 12] },
        { id: 6, name: "AT1 Forecast Points", parentLayerId: 5 },
        { id: 7, name: "AT1 Forecast Track", parentLayerId: 5 },
        { id: 8, name: "AT1 Forecast Cone", parentLayerId: 5 },
        { id: 9, name: "AT1 Watch Warning", parentLayerId: 5 },
        { id: 10, name: "AT1 Past Points", parentLayerId: 5 },
        { id: 11, name: "AT1 Past Track", parentLayerId: 5 },
        { id: 12, name: "AT1 Forecast Wind Radii", parentLayerId: 5 },
        // A leaf without the bin in its own name inherits it from the group.
        { id: 40, name: "EP2", parentLayerId: -1, subLayerIds: [41, 42, 43] },
        { id: 41, name: "Forecast Points", parentLayerId: 40 },
        { id: 42, name: "Forecast_Cone", parentLayerId: 40 },
        { id: 43, name: "Past Track", parentLayerId: 40 },
      ],
    });
    expect(map).toEqual({
      AT1: { forecastPoints: 6, forecastTrack: 7, cone: 8, watchWarning: 9, pastPoints: 10, pastTrack: 11 },
      EP2: { forecastPoints: 41, cone: 42, pastTrack: 43 },
    });
    expect(parseLayerMap({ error: { code: 500 } })).toEqual({});
  });
});

const square = (x: number, y: number) => [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]];
const feature = (geometry: unknown, properties: Record<string, unknown> = {}, id?: number) => ({ type: "Feature", id, geometry, properties });

describe("GeoJSON merge", () => {
  it("merges cone polygons into one geometry", () => {
    expect(mergePolygons({ type: "FeatureCollection", features: [feature({ type: "Polygon", coordinates: square(-80, 25) })] })).toEqual({
      type: "Polygon",
      coordinates: square(-80, 25),
    });
    const merged = mergePolygons({
      type: "FeatureCollection",
      features: [
        feature({ type: "Polygon", coordinates: square(-80, 25) }),
        feature({ type: "MultiPolygon", coordinates: [square(-78, 26), square(-76, 27)] }),
        feature({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }),
        feature(null),
      ],
    });
    expect(merged?.type).toBe("MultiPolygon");
    expect(merged?.coordinates).toHaveLength(3);
    // Web Mercator metres (outSR ignored) are rejected rather than drawn at the wrong place.
    expect(mergePolygons({ features: [feature({ type: "Polygon", coordinates: square(-8_900_000, 2_900_000) })] })).toBeNull();
    expect(mergePolygons({ error: { code: 400 } })).toBeNull();
  });

  it("joins track segments in object-id order", () => {
    const line = mergeLines({
      features: [
        feature({ type: "LineString", coordinates: [[-85, 22], [-84, 23]] }, {}, 2),
        feature({ type: "MultiLineString", coordinates: [[[-87, 21], [-86, 21.5]], [[-86, 21.5], [-85, 22]]] }, {}, 1),
      ],
    });
    expect(line).toEqual({ type: "LineString", coordinates: [[-87, 21], [-86, 21.5], [-85, 22], [-84, 23]] });
    expect(lineThrough([{ lat: 20, lon: -90 }, { lat: 21, lon: -89 }])).toEqual({ type: "LineString", coordinates: [[-90, 20], [-89, 21]] });
    expect(mergeLines({ features: [] })).toBeNull();
  });

  it("drops features left over from a previous storm in the same bin", () => {
    const fc = {
      features: [
        feature(null, { STORMNUM: 14, STORMNAME: "MILTON" }),
        feature(null, { stormnum: "14", stormname: "FOURTEEN" }),
        feature(null, { STORMNUM: 9, STORMNAME: "HELENE" }),
        feature(null, {}),
      ],
    };
    expect(stormFeatures(fc, { id: "al142024", name: "Milton" })).toHaveLength(3);
  });
});

describe("parseForecastPoints", () => {
  it("reads the attribute variants and resolves times", () => {
    const pts = parseForecastPoints(
      {
        type: "FeatureCollection",
        features: [
          feature({ type: "Point", coordinates: [-84.1, 24.3] }, { TAU: 24, VALIDTIME: "09/0000", MAXWIND: 140, DVLBL: "M", SSNUM: 5 }),
          feature({ type: "Point", coordinates: [-91.1, 21.8] }, { TAU: 0, MAXWIND: 155, DVLBL: "M", ADVDATE: "1000 PM CDT Mon Oct 07 2024" }),
          feature({ type: "Point", coordinates: [-82.6, 27.4] }, { tau: 36, maxwnd: "105", stormtype: "HU", advdate: "1000 PM CDT Mon Oct 07 2024" }),
          feature({ type: "Point", coordinates: [-77, 29.4] }, { TAU: 72, INTENSITY: 50, TCDVLP: "Post-Tropical Cyclone", FLDATELBL: "2024-10-10 7:00 PM Thu EDT" }),
          feature({ type: "Point", coordinates: [-70, 31] }, { TAU: 120, SSNUM: 0, MAXWIND: 30, VALIDTIME: Date.UTC(2024, 9, 13, 0) }),
          feature({ type: "Point", coordinates: [-60, 33] }, { TAU: 96, DVLBL: "L" }),
          feature(null, { LAT: 32, LON: -65, TAU: 108 }),
          feature({ type: "Point", coordinates: [999, 999] }, { TAU: 12 }),
        ],
      },
      "2024-10-08T03:00:00.000Z",
    );
    expect(pts.map((p) => [p.tau, p.time, p.windKt, p.label])).toEqual([
      [0, "2024-10-08T03:00:00.000Z", 155, "H5"],
      [24, "2024-10-09T00:00:00.000Z", 140, "H5"],
      [36, "2024-10-09T12:00:00.000Z", 105, "H3"],
      [72, "2024-10-10T23:00:00.000Z", 50, "PT"],
      [96, "2024-10-12T00:00:00.000Z", null, "LO"],
      [108, "2024-10-12T12:00:00.000Z", null, null],
      [120, "2024-10-13T00:00:00.000Z", 30, "TD"],
    ]);
    expect(pts[0]).toMatchObject({ lat: 21.8, lon: -91.1 });
    expect(pts[5]).toMatchObject({ lat: 32, lon: -65 });
  });

  it("keeps points without any usable time", () => {
    const [p] = parseForecastPoints({ features: [feature({ type: "Point", coordinates: [-50, 15] }, { VALIDTIME: "15/1200" })] }, null);
    expect(p).toMatchObject({ lat: 15, lon: -50, time: null, label: null, tau: null });
  });
});

describe("tropicalFeed", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2024, 9, 8, 4));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const LAYERS = {
    layers: [
      { id: 20, name: "AT4 Forecast Points" },
      { id: 21, name: "AT4 Forecast Track" },
      { id: 22, name: "AT4 Forecast Cone" },
      { id: 23, name: "AT4 Past Track" },
    ],
  };
  const LAYER_DATA: Record<string, unknown> = {
    20: { type: "FeatureCollection", features: [feature({ type: "Point", coordinates: [-91.1, 21.8] }, { TAU: 0, MAXWIND: 155, DVLBL: "M" })] },
    21: { type: "FeatureCollection", features: [feature({ type: "LineString", coordinates: [[-91.1, 21.8], [-82.6, 27.4]] })] },
    22: { type: "FeatureCollection", features: [feature({ type: "Polygon", coordinates: square(-90, 22) }, { STORMNAME: "MILTON" })] },
    23: { error: { code: 400, message: "Invalid query" } },
  };

  // First, while the response cache is cold (a stale copy would be served on error).
  it("fails rather than reporting no storms when the storm list is unrecognisable", async () => {
    setUpstreamTransport(async () => ({ message: "Service unavailable" }));
    await expect(tropicalFeed.load(new URLSearchParams())).rejects.toMatchObject({ status: 502 });
  });

  it("returns storms without geometry when the MapServer is down", async () => {
    setUpstreamTransport(async (url) => {
      if (url.includes("CurrentStorms")) return { activeStorms: [MILTON] };
      throw new Error("503");
    });
    const r = await tropicalFeed.load(new URLSearchParams());
    expect(r.storms).toHaveLength(1);
    expect(r.storms[0]).toMatchObject({ title: "Hurricane Milton", cone: null, track: null, forecast: [] });
  });

  it("attaches the cone, track and points by bin", async () => {
    vi.setSystemTime(Date.UTC(2024, 9, 8, 4, 11)); // past the 10-minute response cache
    const seen: string[] = [];
    setUpstreamTransport(async (url) => {
      seen.push(url);
      if (url.includes("CurrentStorms")) return { activeStorms: [MILTON] };
      if (url.endsWith("MapServer?f=json")) return LAYERS;
      const id = url.match(/MapServer\/(\d+)\/query/)?.[1];
      return id ? LAYER_DATA[id] : null;
    });
    const r = await tropicalFeed.load(new URLSearchParams());
    const s = r.storms[0]!;
    expect(s.cone?.type).toBe("Polygon");
    expect(s.track?.coordinates).toHaveLength(2);
    expect(s.forecast).toEqual([expect.objectContaining({ label: "H5", time: "2024-10-08T03:00:00.000Z" })]);
    expect(s.pastTrack).toBeNull();
    expect(seen.some((u) => u.includes("/22/query?") && u.includes("outSR=4326") && u.includes("f=geojson"))).toBe(true);
  });

  it("skips the geometry queries when nothing is active", async () => {
    vi.setSystemTime(Date.UTC(2024, 9, 8, 4, 22));
    const seen: string[] = [];
    setUpstreamTransport(async (url) => {
      seen.push(url);
      return url.includes("CurrentStorms") ? { activeStorms: [] } : LAYERS;
    });
    const r = await tropicalFeed.load(new URLSearchParams());
    expect(r.storms).toEqual([]);
    expect(seen.some((u) => u.includes("/query?"))).toBe(false);
  });
});
