import { describe, expect, it } from "vitest";
import { parseIemProducts, parseIemScans, parseKp, parseSpcOutlook, parseUsgsIv, trimOmm } from "./parse";

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
  it("orders categories from TSTM to HIGH", () => {
    const poly = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const r = parseSpcOutlook({
      features: [
        { geometry: poly, properties: { LABEL: "ENH", LABEL2: "Enhanced Risk", fill: "#E6C27F", stroke: "#E6C27F", VALID: "202610071200" } },
        { geometry: poly, properties: { LABEL: "TSTM", LABEL2: "General Thunderstorms Risk" } },
        { geometry: null, properties: { LABEL: "SLGT" } },
      ],
    });
    expect(r.features.map((f) => f.properties.label)).toEqual(["TSTM", "ENH"]);
    expect(r.valid).toBe("202610071200");
  });
});
