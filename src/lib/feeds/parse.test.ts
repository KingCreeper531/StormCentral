import { describe, expect, it } from "vitest";
import { parseIemProducts, parseIemScans, parseKp, parseSpcOutlook, parseSpcProbOutlook, parseUsgsIv, trimOmm } from "./parse";

describe("parseKp", () => {
  it("reads the legacy table layout", () => {
    const rows = parseKp(
      [
        ["time_tag", "Kp", "a_running", "station_count"],
        ["2026-10-07 09:00:00.000", "2.33", "9", "8"],
        ["2026-10-07 12:00:00.000", "5.67", "48", "8"],
      ],
      "observed",
    );
    expect(rows).toEqual([
      { time: "2026-10-07T09:00:00.000Z", kp: 2.33, kind: "observed" },
      { time: "2026-10-07T12:00:00.000Z", kp: 5.67, kind: "observed" },
    ]);
  });

  it("reads the object layout with forecast kinds", () => {
    const rows = parseKp([{ time_tag: "2026-10-08T00:00:00", kp: 4, observed: "predicted" }, { nope: 1 }], "observed");
    expect(rows).toEqual([{ time: "2026-10-08T00:00:00.000Z", kp: 4, kind: "predicted" }]);
  });
});

describe("parseUsgsIv", () => {
  const ts = (code: string, values: [string, string][], site = "05536890") => ({
    sourceInfo: {
      siteName: "CHICAGO SANITARY AND SHIP CANAL NEAR LEMONT, IL",
      siteCode: [{ value: site }],
      geoLocation: { geogLocation: { latitude: 41.68, longitude: -87.99 } },
    },
    variable: { variableCode: [{ value: code }], unit: { unitCode: code === "00060" ? "ft3/s" : "ft" }, noDataValue: -999999 },
    values: [{ value: values.map(([dateTime, value]) => ({ dateTime, value })) }],
  });

  it("groups series by site and computes 24 h change", () => {
    const sites = parseUsgsIv(
      {
        value: {
          timeSeries: [
            ts("00060", [
              ["2026-10-06T12:00:00.000-05:00", "1000"],
              ["2026-10-07T11:45:00.000-05:00", "-999999"],
              ["2026-10-07T12:00:00.000-05:00", "1250"],
            ]),
            ts("00065", [["2026-10-07T12:00:00.000-05:00", "4.2"]]),
          ],
        },
      },
      { lat: 41.88, lon: -87.63 },
    );
    expect(sites).toHaveLength(1);
    const s = sites[0]!;
    expect(s.name).toBe("Chicago Sanitary and Ship Canal near Lemont, IL");
    expect(s.discharge?.latest).toBe(1250);
    expect(s.discharge?.change24h).toBeCloseTo(0.25);
    expect(s.gageHeight?.latest).toBe(4.2);
    expect(s.waterTemp).toBeNull();
    expect(s.distanceKm).toBeGreaterThan(30);
  });

  it("ignores junk", () => {
    expect(parseUsgsIv(null, { lat: 0, lon: 0 })).toEqual([]);
  });
});

describe("IEM", () => {
  it("normalises scan timestamps and products", () => {
    expect(parseIemScans({ scans: [{ ts: "2026-10-07T14:03Z" }, { ts: "2026-10-07T14:08" }, { ts: "bad" }] })).toEqual([
      "2026-10-07T14:03:00.000Z",
      "2026-10-07T14:08:00.000Z",
    ]);
    expect(parseIemProducts({ products: [{ id: "N0B" }, { id: "N0B" }, "N0G", { id: "bogus!" }] })).toEqual(["N0B", "N0G"]);
  });
});

describe("CelesTrak", () => {
  it("keeps only the SGP4 fields", () => {
    const out = trimOmm([{ OBJECT_NAME: "GPS BIIF-1", EPOCH: "2026-10-01T00:00:00", MEAN_MOTION: 2.0056, SECRET: "x" }, { bad: 1 }], "GPS");
    expect(out).toEqual([{ constellation: "GPS", omm: { OBJECT_NAME: "GPS BIIF-1", EPOCH: "2026-10-01T00:00:00", MEAN_MOTION: 2.0056 } }]);
  });
});

describe("SPC", () => {
  const poly = { type: "Polygon", coordinates: [[[-98, 35], [-96, 35], [-96, 37], [-98, 35]]] };
  const multi = { type: "MultiPolygon", coordinates: [[[[-98, 35], [-96, 35], [-96, 37], [-98, 35]]]] };
  /** Properties as SPC publishes them in the .lyr GeoJSON files. */
  const spcProps = (extra: Record<string, unknown>) => ({
    DN: 2,
    VALID: "202610071300",
    EXPIRE: "202610081200",
    ISSUE: "202610071245",
    ...extra,
  });

  it("orders categories from TSTM to HIGH", () => {
    const r = parseSpcOutlook({
      features: [
        { geometry: poly, properties: { LABEL: "ENH", LABEL2: "Enhanced Risk", fill: "#E6C27F", stroke: "#E6C27F", VALID: "202610071200", EXPIRE: "202610081200" } },
        { geometry: poly, properties: { LABEL: "TSTM", LABEL2: "General Thunderstorms Risk" } },
        { geometry: null, properties: { LABEL: "SLGT" } },
      ],
    });
    expect(r.features.map((f) => f.properties.label)).toEqual(["TSTM", "ENH"]);
    expect(r.features[1]!.properties).toMatchObject({ name: "Enhanced risk", fill: "#E6C27F", rank: 4 });
    // Missing colours fall back to SPC's own palette.
    expect(r.features[0]!.properties).toMatchObject({ name: "General thunderstorms", fill: "#c1e9c1", stroke: "#55bb55", rank: 1 });
    expect(r.valid).toBe("2026-10-07T12:00:00.000Z");
    expect(r.expires).toBe("2026-10-08T12:00:00.000Z");
  });

  it("prefers the ISO time fields when SPC provides them", () => {
    const r = parseSpcOutlook({
      features: [{ geometry: poly, properties: { LABEL: "MRGL", VALID: "garbage", VALID_ISO: "2026-10-07T16:30:00+00:00", EXPIRE_ISO: "2026-10-08T12:00:00+00:00" } }],
    });
    expect(r.valid).toBe("2026-10-07T16:30:00.000Z");
    expect(r.expires).toBe("2026-10-08T12:00:00.000Z");
  });

  it("parses tornado probabilities from decimal labels, lowest first", () => {
    const r = parseSpcProbOutlook(
      {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: multi, properties: spcProps({ DN: 10, LABEL: "0.10", LABEL2: "10% Tornado Risk", stroke: "#DDAA00", fill: "#FFE066" }) },
          { type: "Feature", geometry: multi, properties: spcProps({ DN: 2, LABEL: "0.02", LABEL2: "2% Tornado Risk", stroke: "#005900", fill: "#008B00" }) },
          { type: "Feature", geometry: poly, properties: spcProps({ DN: 5, LABEL: "0.05", LABEL2: "5% Tornado Risk", stroke: "#5C2F19", fill: "#8B4726" }) },
        ],
      },
      "tornado",
    );
    expect(r.features.map((f) => [f.properties.label, f.properties.name, f.properties.rank])).toEqual([
      ["0.02", "2% tornado", 2],
      ["0.05", "5% tornado", 5],
      ["0.10", "10% tornado", 10],
    ]);
    // SPC's own colours win.
    expect(r.features[2]!.properties).toMatchObject({ fill: "#FFE066", stroke: "#DDAA00" });
    expect(r.features.every((f) => !f.properties.significant)).toBe(true);
    expect(r.valid).toBe("2026-10-07T13:00:00.000Z");
    expect(r.expires).toBe("2026-10-08T12:00:00.000Z");
  });

  it("accepts percent labels and falls back to an SPC-like palette per hazard", () => {
    const r = parseSpcProbOutlook(
      {
        features: [
          { geometry: poly, properties: spcProps({ LABEL: "15%", fill: "", stroke: "not-a-colour" }) },
          { geometry: poly, properties: spcProps({ LABEL: "30" }) },
          { geometry: poly, properties: spcProps({ LABEL: "", LABEL2: "45% Hail Risk" }) },
          { geometry: poly, properties: spcProps({ LABEL: "0.6" }) },
        ],
      },
      "hail",
    );
    expect(r.features.map((f) => f.properties.label)).toEqual(["0.15", "0.30", "0.45", "0.60"]);
    // 15% is yellow on the hail scale (it is red on the tornado scale).
    expect(r.features[0]!.properties).toMatchObject({ name: "15% hail", fill: "#ffc800", stroke: "#c89600" });
    expect(r.features[1]!.properties.fill).toBe("#ff0000");

    const torn = parseSpcProbOutlook({ features: [{ geometry: poly, properties: { LABEL: "15%" } }] }, "tornado");
    expect(torn.features[0]!.properties.fill).toBe("#ff0000");
  });

  it("marks significant-severe areas and ranks them above every probability", () => {
    const sig = parseSpcProbOutlook(
      {
        features: [
          { geometry: poly, properties: spcProps({ DN: 10, LABEL: "SIGN", LABEL2: "Significant Severe", stroke: "#000000", fill: "#888888" }) },
          { geometry: poly, properties: spcProps({ LABEL: "0.10", LABEL2: "10% Significant Hail Risk" }) },
        ],
      },
      "hail",
      { significant: true },
    );
    expect(sig.features).toHaveLength(2);
    expect(sig.features.every((f) => f.properties.significant === true)).toBe(true);
    expect(sig.features[0]!.properties).toMatchObject({ label: "SIGN", name: "Significant hail (2 in. or larger)", fill: "#888888" });
    expect(sig.features.every((f) => f.properties.rank > 60)).toBe(true);

    // A SIGN polygon that turns up in the main hazard file is still recognised.
    const mixed = parseSpcProbOutlook({ features: [{ geometry: poly, properties: { LABEL: "SIGN" } }] }, "tornado");
    expect(mixed.features[0]!.properties).toMatchObject({ significant: true, name: "Significant tornado (EF2 or stronger)", stroke: "#000000" });
  });

  it("skips null and non-polygon geometry but still reads times from SPC's no-risk placeholder", () => {
    const r = parseSpcProbOutlook(
      {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: null, properties: spcProps({ DN: 0, LABEL: "", LABEL2: "Less Than 2% All Areas" }) },
          { type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: spcProps({ LABEL: "0.05" }) },
          { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: spcProps({ LABEL: "0.05" }) },
          null,
        ],
      },
      "wind",
    );
    expect(r.features).toEqual([]);
    expect(r.expires).toBe("2026-10-08T12:00:00.000Z");
  });

  it("returns an empty outlook for an empty or malformed file", () => {
    expect(parseSpcProbOutlook({ type: "FeatureCollection", features: [] }, "tornado")).toEqual({ features: [], valid: null, expires: null });
    expect(parseSpcProbOutlook(null, "wind")).toEqual({ features: [], valid: null, expires: null });
    expect(parseSpcOutlook("<html>")).toEqual({ features: [], valid: null, expires: null });
  });
});
