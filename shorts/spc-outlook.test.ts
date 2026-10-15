import { describe, expect, it } from "vitest";
import { parseOutlook } from "./spc-outlook";

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
