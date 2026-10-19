import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawAlertFeature } from "../../src/lib/alerts";
import type { GeoCollection } from "../meta";
import { narration } from "../narration";
import {
  alertEvents,
  breakingLines,
  breakingText,
  breakingTiming,
  highRiskEvent,
  parseAreas,
  placesText,
  placesTitle,
  situationOf,
  toPost,
  vtecOf,
  zoneFor,
  type BreakingEvent,
} from "./breaking";

const fixture = <T,>(scenario: string, file: string) => JSON.parse(readFileSync(join("shorts/fixtures/breaking", scenario, file), "utf8")) as T;
const tornado = fixture<{ features: RawAlertFeature[] }>("tornado-emergency", "nws-active.json").features;
const watch = fixture<{ features: RawAlertFeature[] }>("pds-watch", "nws-active.json").features;
const watchBoxes = fixture<{ features: { geometry: unknown; properties: { num?: number; type?: string; is_pds?: boolean } }[] }>("pds-watch", "iem-watches.json");
// 7:55 PM CDT on the fixtures' evening: the emergency runs to 8:30.
const NOW = Date.parse("2026-05-21T00:55:00Z");

describe("breaking triggers", () => {
  it("reads VTEC", () => {
    expect(vtecOf("/O.CON.KOUN.TO.W.0045.000000T0000Z-260521T0130Z/")).toEqual({ action: "CON", office: "KOUN", phenomena: "TO", significance: "W", etn: 45 });
    expect(vtecOf(undefined)).toBeNull();
  });

  it("finds the Tornado Emergency, from the warning's newest message, and ignores ordinary warnings", () => {
    const events = alertEvents(tornado, null, NOW);
    expect(events.map((e) => e.key)).toEqual(["tornado-emergency:KOUN.TO.W.45.2026"]);
    const e = events[0]!;
    expect(e.issuer).toBe("National Weather Service in Norman, OK");
    expect(e.areas.map((a) => a.name)).toEqual(["Cleveland", "McClain", "Oklahoma"]);
    expect(e.situation).toBe("A confirmed large and destructive tornado was located near Moore, moving east at 25 mph.");
    expect(e.chips).toEqual([
      { label: "TORNADO", value: "OBSERVED" },
      { label: "DAMAGE THREAT", value: "CATASTROPHIC" },
      { label: "HAIL", value: "2.75 IN" },
    ]);
    expect(e.zone).toBe("America/Chicago");
    expect(e.motion).toMatchObject({ lon: -97.52, lat: 35.32, headingDeg: 90, speedKt: 22 });
    expect(e.shapes.features).toHaveLength(1);
  });

  it("keeps the same key across a warning's updates", () => {
    const [first] = alertEvents([tornado[1]!], null, NOW); // the NEW message, a PDS warning then
    expect(first!.key).toBe("pds-tornado-warning:KOUN.TO.W.45.2026");
    expect(first!.key.split(":")[1]).toBe(alertEvents(tornado, null, NOW)[0]!.key.split(":")[1]);
  });

  it("skips a warning that ends within 20 minutes", () => {
    expect(alertEvents(tornado, null, Date.parse("2026-05-21T01:15:00Z"))).toEqual([]);
  });

  it("finds a PDS Tornado Watch from SPC's flag, with every office's counties and SPC's box", () => {
    const [e, ...rest] = alertEvents(watch, watchBoxes, NOW);
    expect(rest).toEqual([]);
    expect(e!.key).toBe("pds-tornado-watch:KWNS.TO.A.201.2026");
    expect(e!.issuer).toBe("Storm Prediction Center");
    expect(e!.areas).toHaveLength(9);
    expect(placesText(e!.areas)).toBe("parts of Oklahoma and Kansas");
    expect(e!.shapes.features).toHaveLength(1);
    // Without SPC's flag, the watch text has to say so itself.
    expect(alertEvents(watch, null, NOW)).toEqual([]);
    const pdsText = watch.map((f) => ({ ...f, properties: { ...f.properties, description: `${f.properties.description}\n\nTHIS IS A PARTICULARLY DANGEROUS SITUATION.` } }));
    expect(alertEvents(pdsText, null, NOW)).toHaveLength(1);
  });

  it("finds a High Risk on SPC's Day 1 outlook, one per day", () => {
    const swo = fixture<{ productText: string; issuanceTime: string }>("high-risk", "swody1.json");
    const cat = fixture<GeoCollection>("high-risk", "day1_cat.geojson");
    const e = highRiskEvent(swo.productText, swo.issuanceTime, cat)!;
    expect(e.key).toBe("high-risk:2026-05-20");
    expect(e.region).toBe("Central Oklahoma");
    expect(e.shapes.features.map((f) => f.properties.LABEL)).toEqual(["HIGH"]);
    expect(e.context.features.map((f) => f.properties.LABEL)).toEqual(["SLGT", "MDT"]);
    expect(highRiskEvent(swo.productText.replace(/HIGH RISK/, "MODERATE RISK"), swo.issuanceTime, cat)).toBeNull();
  });
});

describe("posting", () => {
  const [emergency] = alertEvents(tornado, null, NOW);
  const [pds] = alertEvents([tornado[1]!], null, NOW);

  it("posts each event once, and a warning again only when it's upgraded", () => {
    expect(toPost([emergency!], { posted: {} }, { now: NOW })).toHaveLength(1);
    expect(toPost([emergency!], { posted: { [emergency!.key]: NOW - 60_000 } }, { now: NOW })).toEqual([]);
    expect(toPost([emergency!], { posted: { [pds!.key]: NOW - 60_000 } }, { now: NOW })).toHaveLength(1);
    expect(toPost([pds!], { posted: { [emergency!.key]: NOW - 60_000 } }, { now: NOW })).toEqual([]);
  });

  it("stops at the daily cap, counted on YouTube's Pacific-time day", () => {
    const today = { posted: { "high-risk:a": NOW - 3_600_000, "extreme-wind:b": NOW - 7_200_000 } };
    expect(toPost([emergency!], today, { dailyMax: 2, now: NOW })).toEqual([]);
    expect(toPost([emergency!], today, { dailyMax: 3, now: NOW })).toHaveLength(1);
    const yesterday = { posted: { "high-risk:a": NOW - 30 * 3_600_000, "extreme-wind:b": NOW - 30 * 3_600_000 } };
    expect(toPost([emergency!], yesterday, { dailyMax: 2, now: NOW })).toHaveLength(1);
  });
});

describe("breaking text", () => {
  const e = alertEvents(tornado, null, NOW)[0]!;
  const lines = breakingLines(e);

  it("reads the warning's facts", () => {
    expect(lines).toEqual({
      intro: "Breaking: the National Weather Service in Norman, OK has issued a Tornado Emergency for Cleveland, McClain and Oklahoma counties in Oklahoma.",
      situation: "A confirmed large and destructive tornado was located near Moore, moving east at 25 mph.",
      until: "It's in effect until 8:30 PM Central time.",
      safety: "If you're in the path, take cover now in a basement or an interior room on the lowest floor.",
    });
    const cues = narration({ template: "breaking.html", data: { lines, timing: breakingTiming(lines) } });
    expect(cues.map((c) => c.text)[0]).toBe(
      "Breaking: the National Weather Service in Norman, Oklahoma has issued a Tornado Emergency for Cleveland, McClain and Oklahoma counties in Oklahoma.",
    );
    expect(cues.map((c) => c.text)[1]).toContain("moving east at 25 miles per hour");
    expect(cues.map((c) => c.at)).toEqual([...cues.map((c) => c.at)].sort((a, b) => a - b));
  });

  it("gives each line time to be read before the next scene", () => {
    const t = breakingTiming(lines);
    expect(t.situation).toBeGreaterThanOrEqual(6.2);
    expect(t.until).toBeGreaterThan(t.situation + 3);
    expect(t.safety).toBeGreaterThan(t.until);
    expect(t.end).toBeGreaterThan(t.safety + 3);
  });

  it("writes the title and descriptions in English and Spanish", () => {
    const text = breakingText(e, lines);
    expect(text.title).toBe("Tornado Emergency for Cleveland, McClain and Oklahoma Counties, OK Until 8:30 PM CDT #shorts");
    expect(text.description).toContain("BREAKING: The National Weather Service in Norman, OK has issued a Tornado Emergency");
    expect(text.description).toContain("until 8:30 PM CDT.");
    expect(text.description).toContain("Not an official warning source; follow the National Weather Service.");
    expect(text.es.title).toMatch(/^Emergencia por tornado: Oklahoma, hasta las 8:30/);
    expect(text.es.description).toContain("No es una fuente oficial de alertas");
  });

  it("writes a watch and a High Risk too", () => {
    const w = alertEvents(watch, watchBoxes, NOW)[0]!;
    expect(breakingLines(w).intro).toBe("Breaking: the Storm Prediction Center has issued a particularly dangerous situation Tornado Watch for parts of Oklahoma and Kansas.");
    expect(breakingText(w, breakingLines(w)).title).toBe("PDS Tornado Watch for Oklahoma and Kansas Until 9:00 PM CDT #shorts");
    const swo = fixture<{ productText: string; issuanceTime: string }>("high-risk", "swody1.json");
    const h = highRiskEvent(swo.productText, swo.issuanceTime, null) as BreakingEvent;
    const hl = breakingLines(h);
    expect(hl.intro).toBe("Breaking: the Storm Prediction Center has issued a High Risk of severe storms, level 5 of 5, for the Central Oklahoma.");
    expect(hl.situation).toContain("A tornado outbreak is expected");
    expect(breakingText(h, hl).title).toBe("High Risk of Severe Storms for Central Oklahoma #shorts");
  });
});

describe("places and clocks", () => {
  it("names the areas for reading and for titles", () => {
    const areas = parseAreas("Caddo Parish, LA; Bossier, LA; Bossier, LA");
    expect(areas).toHaveLength(2);
    expect(placesText(areas)).toBe("Caddo Parish and Bossier parishes in Louisiana");
    expect(placesTitle(parseAreas("Cleveland, OK"))).toBe("Cleveland County, OK");
    expect(placesTitle(parseAreas("Cleveland, OK; Sedgwick, KS"))).toBe("Oklahoma and Kansas");
  });

  it("takes the time zone from the alert's own offset where a state is split", () => {
    expect(zoneFor("TX", "2026-05-20T20:15:00-05:00")).toBe("America/Chicago");
    expect(zoneFor("TX", "2026-05-20T20:15:00-06:00")).toBe("America/Denver");
    expect(zoneFor("AZ", "2026-07-01T18:00:00-07:00")).toBe("America/Phoenix");
    expect(zoneFor("FL", "2026-05-20T20:15:00-05:00")).toBe("America/Chicago");
  });

  it("keeps abbreviations inside the situation sentence", () => {
    expect(situationOf("At 905 PM CDT, a confirmed tornado was located near St. Louis, moving northeast at 40 mph.\n\nHAZARD...Tornado.")).toBe(
      "A confirmed tornado was located near St. Louis, moving northeast at 40 mph.",
    );
    expect(situationOf("AT 905 PM CDT, A CONFIRMED TORNADO WAS LOCATED NEAR ENID, MOVING EAST AT 30 MPH.")).toBe("A confirmed tornado was located near enid, moving east at 30 mph.");
    expect(situationOf("No situation here.")).toBeNull();
  });
});
