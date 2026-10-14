import { describe, expect, it } from "vitest";
import { composeOutlookPost, outlookImageUrl, parseOutlook, riskText } from "./outlook";
import { weightedLength } from "./select";

// SPC's 1630Z Day 1 outlook for 14 Oct 2026, as the NWS API serves it (trimmed after the first section).
const SLIGHT = `
000
ACUS01 KWNS 141632
SWODY1
SPC AC 141630

Day 1 Convective Outlook  
NWS Storm Prediction Center Norman OK
1130 AM CDT Wed Oct 14 2026

Valid 141630Z - 151200Z

...THERE IS A SLIGHT RISK OF SEVERE THUNDERSTORMS ACROSS THE
SOUTHERN PLAINS...

...SUMMARY...
Thunderstorms with severe wind gusts and some tornado threat are
possible this afternoon and evening across parts of the southern
Plains. A marginal wind-damage risk is possible across parts of the
Ohio Valley and Mid-Atlantic.

...Southern Plains/Southern High Plains...
Extensive showers and thunderstorms continue at midday across the
majority of Oklahoma to the Ozarks.

..Guyer/Jirak.. 10/14/2026

$$
`;

const MODERATE = `
SPC AC 151249

Day 1 Convective Outlook
NWS Storm Prediction Center Norman OK
0749 AM CDT Thu May 15 2026

Valid 151300Z - 161200Z

...THERE IS A MODERATE RISK OF SEVERE THUNDERSTORMS ACROSS PARTS OF
CENTRAL AND EASTERN OKLAHOMA...

...THERE IS AN ENHANCED RISK OF SEVERE THUNDERSTORMS ACROSS PARTS OF
NORTH TEXAS AND SOUTHERN KANSAS...

...SUMMARY...
Severe thunderstorms are expected this afternoon into tonight across
the southern Plains. Several tornadoes, some strong, along with very
large hail and damaging winds are likely. The greatest threat is
across central and eastern Oklahoma, where long-tracked tornadoes are
possible this evening. Additional storms may produce hail overnight
across Missouri and Arkansas.
...Central and Eastern Oklahoma...
Discussion.
`;

const QUIET = `
SPC AC 161244

Day 1 Convective Outlook
NWS Storm Prediction Center Norman OK
0744 AM CST Mon Dec 16 2026

Valid 161300Z - 171200Z

...NO SEVERE THUNDERSTORM AREAS FORECAST...

...SUMMARY...
Severe thunderstorms are not expected today.

...Discussion...
Isolated thunderstorms are possible over the Florida Keys.
`;

describe("parseOutlook", () => {
  it("reads the cycle, the risk and the summary", () => {
    expect(parseOutlook(SLIGHT)).toEqual({
      validFrom: "141630Z",
      cycle: "1630",
      risk: "SLIGHT",
      summary:
        "Thunderstorms with severe wind gusts and some tornado threat are possible this afternoon and evening across parts of the southern Plains. A marginal wind-damage risk is possible across parts of the Ohio Valley and Mid-Atlantic.",
    });
  });

  it("takes the highest of several risk areas and stops the summary at the next section", () => {
    const o = parseOutlook(MODERATE)!;
    expect(o.cycle).toBe("1300");
    expect(o.risk).toBe("MODERATE");
    expect(o.summary).toMatch(/^Severe thunderstorms are expected/);
    expect(o.summary).toMatch(/across Missouri and Arkansas\.$/);
  });

  it("knows a day with no severe risk", () => {
    expect(parseOutlook(QUIET)).toMatchObject({ cycle: "1300", risk: null, summary: "Severe thunderstorms are not expected today." });
  });

  it("rejects other products", () => {
    expect(parseOutlook("Mesoscale Discussion 1234\nValid 141630Z - 141800Z")).toBeNull();
  });
});

describe("composeOutlookPost", () => {
  it("leads with the risk and its level, then SPC's summary", () => {
    const text = composeOutlookPost(parseOutlook(SLIGHT)!);
    expect(text).toMatch(/^Today's severe weather outlook: Slight Risk \(level 2 of 5\)\n\nThunderstorms with severe wind gusts/);
    expect(text).toMatch(/Source: NOAA Storm Prediction Center #severewx\nhttps:\/\/storm-central-pi\.vercel\.app\/\?mode=severe$/);
    expect(weightedLength(text)).toBeLessThanOrEqual(280);
  });

  it("drops whole sentences of a long summary to fit", () => {
    const text = composeOutlookPost(parseOutlook(MODERATE)!);
    expect(text).toMatch(/^Today's severe weather outlook: Moderate Risk \(level 4 of 5\)/);
    expect(text).toContain("Severe thunderstorms are expected this afternoon into tonight across the southern Plains.");
    expect(text).not.toContain("Missouri");
    expect(text).not.toContain("…");
    expect(weightedLength(text)).toBeLessThanOrEqual(280);
  });

  it("leaves the link out when asked, keeping at least as much summary", () => {
    const withLink = composeOutlookPost(parseOutlook(MODERATE)!);
    const without = composeOutlookPost(parseOutlook(MODERATE)!, { links: false });
    expect(without).not.toContain("https://");
    const summary = (t: string) => t.split("\n\n")[1]!;
    expect(summary(without).length).toBeGreaterThanOrEqual(summary(withLink).length);
    expect(weightedLength(without)).toBeLessThanOrEqual(280);
  });

  it("cuts a single over-long sentence at a word", () => {
    const o = { ...parseOutlook(SLIGHT)!, summary: `${"Storms are possible across the region ".repeat(12).trim()}.` };
    const text = composeOutlookPost(o);
    expect(text).toMatch(/ the…\n\nSource:/);
    expect(weightedLength(text)).toBeLessThanOrEqual(280);
  });

  it("says so on a quiet day", () => {
    expect(composeOutlookPost(parseOutlook(QUIET)!, { links: false })).toBe(
      "Today's severe weather outlook: no severe storms expected\n\nSevere thunderstorms are not expected today.\n\nSource: NOAA Storm Prediction Center #severewx",
    );
  });
});

describe("helpers", () => {
  it("names each level", () => {
    expect(riskText("MARGINAL")).toBe("Marginal Risk (level 1 of 5)");
    expect(riskText("HIGH")).toBe("High Risk (level 5 of 5)");
  });

  it("points at the cycle's map", () => {
    expect(outlookImageUrl("1300")).toBe("https://www.spc.noaa.gov/products/outlook/day1otlk_1300.png");
  });

  it("weighs text the way X does", () => {
    expect(weightedLength("abc")).toBe(3);
    expect(weightedLength("a…")).toBe(3);
    expect(weightedLength("🌀")).toBe(2);
    expect(weightedLength("see https://example.com/a/very/long/path?x=1")).toBe(4 + 23);
  });
});
