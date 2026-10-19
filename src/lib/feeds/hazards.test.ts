import { describe, expect, it } from "vitest";
import { alertCategory, hazardColor, visibleHazards } from "../alerts";
import type { WeatherAlert } from "../api/types";
import { parseDiscussions, parseDwd, parseEccc, parseWatchOutlines, parseWwa, simplifyRing } from "./hazards";

const NOW = Date.parse("2026-10-19T17:30:00Z");
const square = (x: number, y: number, d = 0.5) => [
  [
    [x, y],
    [x + d, y],
    [x + d, y + d],
    [x, y + d],
    [x, y],
  ],
];

describe("alert categories and colours", () => {
  it("groups products for the map filter", () => {
    expect(alertCategory("Winter Storm Warning")).toBe("warning");
    expect(alertCategory("Flood Watch")).toBe("watch");
    expect(alertCategory("Wind Advisory")).toBe("advisory");
    expect(alertCategory("Air Quality Alert")).toBe("advisory");
    expect(alertCategory("Rip Current Statement")).toBe("statement");
    expect(alertCategory("Small Craft Advisory")).toBe("marine");
    expect(alertCategory("Gale Warning")).toBe("marine");
    expect(alertCategory("Mesoscale Discussion")).toBe("discussion");
  });

  it("uses NWS map colours and falls back by kind", () => {
    expect(hazardColor("Tornado Warning")).toBe("#ff0000");
    expect(hazardColor("Small Craft Advisory")).toBe("#d8bfd8");
    expect(hazardColor("Made Up Watch")).toBe("#f5c518");
  });
});

describe("NWS hazard map (WWA)", () => {
  const fc = {
    features: [
      // One advisory drawn as two zone polygons.
      {
        geometry: { type: "Polygon", coordinates: square(-97, 35) },
        properties: { cap_id: "urn:oid:2.49.0.1.840.0.abc.001.1", prod_type: "Wind Advisory", wfo: "KOUN", issuance: "2026-10-19T13:05:00-04:00", expiration: "2026-10-19T20:00:00-04:00", ends: "2026-10-20T02:00:00-04:00", url: "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc.001.1" },
      },
      {
        geometry: { type: "MultiPolygon", coordinates: [square(-96, 35)] },
        properties: { cap_id: "urn:oid:2.49.0.1.840.0.abc.001.1", prod_type: "Wind Advisory", wfo: "KOUN", issuance: "2026-10-19T13:05:00-04:00", expiration: "2026-10-19T20:00:00-04:00", ends: "2026-10-20T02:00:00-04:00" },
      },
      // Expired.
      {
        geometry: { type: "Polygon", coordinates: square(-90, 40) },
        properties: { cap_id: "urn:oid:old", prod_type: "Frost Advisory", wfo: "KLOT", issuance: "2026-10-19T03:00:00-05:00", expiration: "2026-10-19T09:00:00-05:00", ends: "2026-10-19T09:00:00-05:00" },
      },
    ],
  };

  it("joins zone pieces into one lean alert and drops expired ones", () => {
    const out = parseWwa(fc, NOW);
    expect(out).toHaveLength(1);
    const a = out[0]!;
    expect(a.id).toBe("urn:oid:2.49.0.1.840.0.abc.001.1");
    expect(a.event).toBe("Wind Advisory");
    expect(a.category).toBe("advisory");
    expect(a.lean).toBe(true);
    expect(a.area).toBe(true);
    expect(a.sender).toBe("NWS OUN");
    expect(a.geometry?.type).toBe("MultiPolygon");
    expect(a.expires).toBe("2026-10-20T00:00:00.000Z");
    expect(a.ends).toBe("2026-10-20T06:00:00.000Z");
  });
});

describe("SPC and WPC", () => {
  it("reads mesoscale discussions with their IEM text link", () => {
    const out = parseDiscussions(
      {
        features: [
          { geometry: { type: "Polygon", coordinates: square(-98, 36) }, properties: { product_id: "202610191720-KWNS-ACUS11-SWOMCD", year: 2026, num: 2350, issue: "2026-10-19T17:20:00Z", expire: "2026-10-19T19:00:00Z", watch_confidence: 40, concerning: "SEVERE POTENTIAL...WATCH POSSIBLE" } },
          { geometry: { type: "Polygon", coordinates: square(-98, 36) }, properties: { product_id: "x", year: 2026, num: 2300, issue: "2026-10-18T17:20:00Z", expire: "2026-10-18T19:00:00Z" } },
        ],
      },
      "spc",
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("spc-md-2026-2350");
    expect(out[0]!.event).toBe("Mesoscale Discussion");
    expect(out[0]!.category).toBe("discussion");
    expect(out[0]!.description).toContain("40%");
    expect(out[0]!.url).toBe("https://mesonet.agron.iastate.edu/api/1/nwstext/202610191720-KWNS-ACUS11-SWOMCD");
  });

  it("reads watch boxes as outlines", () => {
    const out = parseWatchOutlines({ features: [{ geometry: { type: "MultiPolygon", coordinates: [square(-99, 34, 2)] }, properties: { type: "TOR", num: 612, utc_issued: "2026-10-19T17:00:00Z", utc_expired: "2026-10-20T01:00:00Z" } }] }, NOW);
    expect(out[0]!.event).toBe("Tornado Watch");
    expect(out[0]!.area).toBe(false);
    expect(out[0]!.url).toContain("ww0612.html");
  });
});

describe("other countries", () => {
  it("groups a Canadian statement's areas", () => {
    const base = { alert_code: "SPS", alert_type: "statement", alert_name_en: "special weather statement", alert_text_en: "Very strong winds expected.", province: "YT", publication_datetime: "2026-10-19T12:15:30Z", expiration_datetime: "2026-10-20T04:15:30Z", event_end_datetime: "2026-10-21T10:00:00Z", risk_colour_en: null };
    const out = parseEccc(
      {
        features: [
          { geometry: { type: "Polygon", coordinates: square(-135, 60) }, properties: { ...base, feature_name_en: "Whitehorse" } },
          { geometry: { type: "Polygon", coordinates: square(-134, 60) }, properties: { ...base, feature_name_en: "Teslin" } },
          { geometry: { type: "Polygon", coordinates: square(-57, 51) }, properties: { ...base, alert_code: "WW", alert_type: "warning", alert_name_en: "wind warning", alert_text_en: "Strong winds.", province: "NL", risk_colour_en: "yellow", feature_name_en: "Red Bay" } },
        ],
      },
      NOW,
    );
    expect(out).toHaveLength(2);
    const sps = out.find((a) => a.event === "Special Weather Statement")!;
    expect(sps.areaDesc).toBe("Whitehorse; Teslin");
    expect(sps.source).toBe("eccc");
    expect(sps.category).toBe("statement");
    const ww = out.find((a) => a.event === "Wind Warning")!;
    expect(ww.category).toBe("warning");
    expect(ww.color).toBe("#facc15");
  });

  it("translates German warnings and keeps DWD's colour", () => {
    const out = parseDwd(
      {
        features: [
          {
            geometry: { type: "MultiPolygon", coordinates: [square(7.9, 54.1, 0.1)] },
            properties: { IDENTIFIER: "2.49.0.1.276.DWD.1", EVENT: "STURMBÖEN", SEVERITY: "Moderate", HEADLINE: "Amtliche WARNUNG vor STURMBÖEN", DESCRIPTION: "Es treten Sturmböen auf.", EC_AREA_COLOR: "255 153 0", SENT: "2026-10-19T17:23:00Z", EXPIRES: "2026-10-20T02:00:00Z" },
          },
        ],
      },
      NOW,
    );
    expect(out[0]!.event).toBe("Gale-force gusts warning (DWD)");
    expect(out[0]!.color).toBe("#ff9900");
    expect(out[0]!.category).toBe("warning");
    expect(out[0]!.severity).toBe("Moderate");
  });
});

describe("map filtering", () => {
  const a = (id: string, event: string, extra: Partial<WeatherAlert> = {}) =>
    ({ id, event, category: alertCategory(event), geometry: { type: "Polygon", coordinates: square(0, 0) }, ...extra }) as WeatherAlert;

  it("keeps picked kinds, skips what the warnings feed has, and honours the other-countries switch", () => {
    const hazards = [a("1", "Wind Advisory"), a("2", "Flood Watch"), a("3", "Small Craft Advisory"), a("4", "Tornado Warning"), a("5", "Wind Warning", { source: "eccc" })];
    const warnings = [a("4", "Tornado Warning")];
    expect(visibleHazards(hazards, warnings, ["advisory", "warning"], true).map((x) => x.id)).toEqual(["1", "5"]);
    expect(visibleHazards(hazards, warnings, ["advisory", "warning"], false).map((x) => x.id)).toEqual(["1"]);
  });
});

describe("simplifyRing", () => {
  it("drops points on a straight edge and keeps the corners", () => {
    const ring: [number, number][] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    expect(simplifyRing(ring, 0.01)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });
});
