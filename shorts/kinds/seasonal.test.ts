import { describe, expect, it } from "vitest";
import { narration } from "../narration";
import { oddsAt, pickLead, REGIONS, regionLeans, seasonalText, seasonOf, sideOf, summarize, type OutlookCollection, type OutlookFeature } from "./seasonal";

/** A lon/lat box as a CPC outlook polygon. */
const box = (cat: string, prob: number, [w, s, e, n]: [number, number, number, number], holes: number[][][] = []): OutlookFeature => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]], ...holes] },
  properties: { cat, prob, valid_seas: "DJF 2026-2027", fcst_date: Date.parse("2026-10-15T00:00:00Z") },
});
const fc = (...features: OutlookFeature[]): OutlookCollection => ({ type: "FeatureCollection", features });

// Like NOAA's 2026-27 Winter Outlook: warmer across the north (most likely around the Great Lakes), wetter across the south.
const TEMP = fc(box("EC", 33, [-180, 10, -50, 75]), box("Above", 33, [-130, 40.3, -66, 50]), box("Above", 40, [-126, 41, -67, 50]), box("Above", 50, [-90, 40.5, -77, 47]));
const PRCP = fc(box("Above", 33, [-125, 24, -74, 38]), box("Above", 40, [-125, 24, -79, 37]), box("Below", 33, [-118, 43.5, -104, 49]));
const WINTER = seasonOf("DJF 2026-2027")!;

describe("seasonal outlook", () => {
  it("reads CPC's seasons, across the new year too", () => {
    expect(WINTER).toMatchObject({ code: "DJF", name: "Winter", month: 11, year: 2026, range: "Dec 2026 – Feb 2027", spoken: "December through February", years: "2026-27" });
    expect(seasonOf("NDJ 2026-2027")).toMatchObject({ name: null, range: "Nov 2026 – Jan 2027", years: "2026-27" });
    expect(seasonOf("JFM 2027")).toMatchObject({ name: null, month: 0, range: "Jan 2027 – Mar 2027", years: "2027" });
    expect(seasonOf("MAM 2027")?.name).toBe("Spring");
    expect(seasonOf("XYZ 2027")).toBeNull();
    expect(seasonOf("")).toBeNull();
  });

  it("shows the next winter, spring, summer or fall when it starts within two months", () => {
    expect(pickLead("NDJ 2026-2027", "DJF 2026-2027")).toBe(2); // October: the Winter Outlook
    expect(pickLead("DJF 2026-2027", "JFM 2027")).toBe(1); // November
    expect(pickLead("JFM 2027", "FMA 2027")).toBe(1); // December: the next three months
  });

  it("finds the highest odds at a point, outside holes and in multipolygons", () => {
    expect(oddsAt(TEMP, [-83.05, 42.33])).toEqual({ cat: "Above", prob: 50 });
    expect(oddsAt(TEMP, [-97.52, 35.47])).toBeNull(); // equal chances
    const holed = fc(box("Below", 40, [-100, 30, -90, 40], [[[-96, 34], [-94, 34], [-94, 36], [-96, 36], [-96, 34]]]));
    expect(oddsAt(holed, [-95, 35])).toBeNull();
    expect(oddsAt(holed, [-98, 35])).toEqual({ cat: "Below", prob: 40 });
    const multi: OutlookCollection = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "MultiPolygon", coordinates: [box("x", 0, [0, 0, 1, 1]).geometry!.coordinates as number[][][], box("x", 0, [5, 5, 6, 6]).geometry!.coordinates as number[][][]] }, properties: { cat: "Normal", prob: 40 } }] };
    expect(oddsAt(multi, [5.5, 5.5])).toEqual({ cat: "Normal", prob: 40 });
  });

  it("names the regions where most of their cities lean the same way", () => {
    const leans = regionLeans(TEMP);
    expect(leans.every((l) => l.cat === "Above")).toBe(true);
    expect(leans.map((l) => l.region.name)).toEqual(expect.arrayContaining(["Pacific Northwest", "Northern Plains", "Great Lakes", "Northeast"]));
    expect(leans.map((l) => l.region.name)).not.toContain("Southern Plains");
    expect(leans.find((l) => l.region.name === "Great Lakes")!.prob).toBe(50);
    expect(leans.find((l) => l.region.name === "Northeast")!.prob).toBe(40);
    expect(sideOf(leans.map((l) => l.region))).toBe("north");
    expect(sideOf(REGIONS.filter((r) => ["Southwest", "Southern Plains", "Florida"].includes(r.name)))).toBe("south");
    expect(sideOf(REGIONS.slice(0, 2))).toBeNull();
  });

  it("writes the lines, the panel and the headline from the leans", () => {
    const t = summarize("temp", TEMP, WINTER);
    expect(t.lines[0]).toBe("Warmer than normal is favored across much of the north, including the Upper Midwest, the Great Lakes and the Pacific Northwest.");
    expect(t.lines[1]).toBe("The odds are highest in the Upper Midwest: 50 percent or more for a warmer than normal winter.");
    expect(t.panel[0]).toMatch(/^Warmer: Pacific Northwest, .*Northeast$/);
    expect(t.headline).toBe("Warmer North");
    const p = summarize("prcp", PRCP, WINTER);
    expect(p.headline).toBe("Wetter South");
    expect(p.lines[1]).toBe("Drier than normal is favored across the Northern Rockies.");
    expect(p.panel).toEqual([expect.stringMatching(/^Wetter: California, .*Florida/), "Drier: Northern Rockies"]);
    expect(p.headlineEs).toBe("Más húmedo en el sur");
  });

  it("says so when nothing leans", () => {
    const s = summarize("temp", fc(box("EC", 33, [-180, 10, -50, 75])), WINTER);
    expect(s.headline).toBeNull();
    expect(s.panel).toEqual(["Equal chances nearly everywhere"]);
    expect(s.lines[0]).toBe("For temperatures, no region leans clearly either way.");
  });

  it("titles and describes it in English and Spanish", () => {
    const issued = Date.parse("2026-10-15T00:00:00Z");
    const text = seasonalText(WINTER, summarize("temp", TEMP, WINTER), summarize("prcp", PRCP, WINTER), issued);
    expect(text.title).toBe("NOAA Winter Outlook 2026-27: Warmer North, Wetter South #shorts");
    expect(text.es.title).toBe("NOAA, pronóstico de invierno 2026-27: Más cálido en el norte, Más húmedo en el sur #shorts");
    for (const t of [text.title, text.es.title]) {
      expect(t.length).toBeLessThanOrEqual(100);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(text.description).toContain("issued October 15, 2026");
    expect(text.description).toContain("December through February (Dec 2026 – Feb 2027)");
    expect(text.description).toContain("https://www.stormcentralwx.com");
    expect(text.es.description).toContain("diciembre a febrero");
    const ndj = seasonOf("NDJ 2026-2027")!;
    expect(seasonalText(ndj, summarize("temp", TEMP, ndj), summarize("prcp", PRCP, ndj), issued).title).toBe("NOAA 3-Month Outlook Nov–Jan 2026-27: Warmer North, Wetter South #shorts");
  });

  it("narrates each map's lines in its scene", () => {
    const t = summarize("temp", TEMP, WINTER);
    const p = summarize("prcp", PRCP, WINTER);
    const cues = narration({ template: "seasonal.html", data: { season: { name: "Winter", spoken: WINTER.spoken }, temp: { lines: t.lines }, prcp: { lines: p.lines } } });
    expect(cues.map((c) => c.at)).toEqual([0.4, 3.9, 9.6, 15.9, 21.6, 27.7]);
    expect(cues[0]!.text).toBe("Here's NOAA's winter outlook, for December through February.");
    expect(cues[1]!.text).toBe(t.lines[0]);
  });
});
