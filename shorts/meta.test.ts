import { describe, expect, it } from "vitest";
import { parseOutlook } from "../bot/outlook";
import { descriptionFor, drawable, maxProbability, outlookDay, regionOf, tagsFor, titleFor, type GeoCollection } from "./meta";

const SLIGHT = `SPC AC 141630

Day 1 Convective Outlook
NWS Storm Prediction Center Norman OK
1130 AM CDT Wed Oct 14 2026

Valid 141630Z - 151200Z

...THERE IS A SLIGHT RISK OF SEVERE THUNDERSTORMS ACROSS THE
SOUTHERN PLAINS...

...SUMMARY...
Thunderstorms with severe wind gusts and some tornado threat are
possible this afternoon and evening across parts of the southern
Plains.

...Southern Plains...
Discussion.
`;
const QUIET = `Day 1 Convective Outlook
Valid 161300Z - 171200Z

...NO SEVERE THUNDERSTORM AREAS FORECAST...

...SUMMARY...
Severe thunderstorms are not expected today.
`;
const ISSUED = Date.parse("2026-10-14T16:32:00Z");
const fc = (...labels: string[]): GeoCollection => ({
  type: "FeatureCollection",
  features: labels.map((LABEL) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { LABEL } })),
});

describe("regionOf", () => {
  it("title-cases the headline's area", () => {
    expect(regionOf(SLIGHT)).toBe("Southern Plains");
    expect(regionOf("...THERE IS AN ENHANCED RISK OF SEVERE THUNDERSTORMS ACROSS PARTS OF THE SOUTHERN HIGH PLAINS INTO THE OZARKS...")).toBe("Southern High Plains into the Ozarks");
    expect(regionOf("...THERE IS A MARGINAL RISK OF SEVERE THUNDERSTORMS OVER PORTIONS OF FLORIDA...")).toBe("Florida");
  });

  it("gives nothing on a quiet day or for a headline too long to show", () => {
    expect(regionOf(QUIET)).toBe("");
    expect(regionOf(`...THERE IS A SLIGHT RISK OF SEVERE THUNDERSTORMS ACROSS ${"VERY LONG PLACE NAME ".repeat(5)}...`)).toBe("");
  });
});

describe("hazards", () => {
  it("takes the highest probability, ignoring hatching and conditional-intensity labels", () => {
    expect(maxProbability(fc("0.05", "0.15", "CIG1", "SIGN"))).toBe(15);
    expect(maxProbability(fc("0.02"))).toBe(2);
    expect(maxProbability(fc())).toBe(0);
    expect(maxProbability(null)).toBe(0);
  });

  it("keeps only features with a shape and a label", () => {
    const placeholders: GeoCollection = { type: "FeatureCollection", features: [{ type: "Feature", geometry: null, properties: { LABEL: "" } }, ...fc("TSTM").features] };
    expect(drawable(placeholders).features.map((f) => f.properties.LABEL)).toEqual(["TSTM"]);
  });
});

describe("video text", () => {
  const o = parseOutlook(SLIGHT)!;
  const quiet = parseOutlook(QUIET)!;

  it("dates the video in Central time", () => {
    expect(outlookDay(ISSUED)).toBe("Wednesday, October 14");
    // 03:00Z on the 15th is still the evening of the 14th in Oklahoma.
    expect(outlookDay(Date.parse("2026-10-15T03:00:00Z"))).toBe("Wednesday, October 14");
  });

  it("titles it with the risk and the region, within YouTube's 100 characters", () => {
    expect(titleFor(o, "Southern Plains", ISSUED)).toBe("Severe Weather Outlook, Wed, Oct 14: Slight Risk for the Southern Plains #shorts");
    expect(titleFor(quiet, "", ISSUED)).toBe("Severe Weather Outlook, Wed, Oct 14: No Severe Risk #shorts");
    expect(titleFor(o, "X".repeat(80), ISSUED).length).toBeLessThanOrEqual(100);
  });

  it("describes it with the summary, the hazards, the link and the disclaimer", () => {
    const d = descriptionFor(o, "Southern Plains", { tornado: 2, wind: 15, hail: 15 });
    expect(d).toMatch(/^Today's severe weather outlook from NOAA's Storm Prediction Center: Slight Risk \(level 2 of 5\) for the Southern Plains\./);
    expect(d).toContain("Thunderstorms with severe wind gusts");
    expect(d).toContain("Tornado 2%, damaging wind 15%, large hail 15%");
    expect(d).toContain("https://www.stormcentralwx.com");
    expect(d).toContain("not an official warning system");
    expect(d.length).toBeLessThanOrEqual(5000);
    expect(descriptionFor(quiet, "", { tornado: 0, wind: 0, hail: 0 })).toMatch(/no severe thunderstorms are forecast/);
  });

  it("tags it", () => {
    expect(tagsFor(o, "Southern Plains")).toEqual(expect.arrayContaining(["severe weather", "slight risk", "Southern Plains"]));
  });
});
