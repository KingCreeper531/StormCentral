import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawAlertFeature } from "../src/lib/alerts";
import { activeWarnings, announcement, briefingFacts, checkBriefing, counts, cycle, sceneTitle, ticker, worthAnnouncing, type StreamWarning } from "./plan";

const NOW = Date.parse("2026-05-21T00:55:00Z");
const features = (JSON.parse(readFileSync("shorts/fixtures/breaking/tornado-emergency/nws-active.json", "utf8")) as { features: RawAlertFeature[] }).features;

describe("activeWarnings", () => {
  const ws = activeWarnings(features, NOW);

  it("keeps one entry per warning, from its newest message, most serious first", () => {
    expect(ws.map((w) => w.key)).toEqual(["KOUN.TO.W.45.2026", "KTSA.TO.W.31.2026"]);
    expect(ws[0]!.name).toBe("Tornado Emergency");
    expect(ws[0]!.areas.map((a) => a.name)).toEqual(["Cleveland", "McClain", "Oklahoma"]);
    expect(ws[0]!.lat).toBeGreaterThan(34.5);
    expect(ws[0]!.lat).toBeLessThan(36);
  });

  it("drops warnings that have ended", () => {
    expect(activeWarnings(features, Date.parse("2026-05-21T01:20:00Z")).map((w) => w.key)).toEqual(["KOUN.TO.W.45.2026"]);
    expect(activeWarnings(features, Date.parse("2026-05-21T02:00:00Z"))).toEqual([]);
  });
});

describe("what's read and shown", () => {
  const [emergency] = activeWarnings(features, NOW);

  it("reads a new warning from its own facts", () => {
    const s = announcement(emergency!);
    expect(s).toMatch(/^A Tornado Emergency has been issued for Cleveland, McClain and Oklahoma counties in Oklahoma, until 8:30 PM Central time\./);
    expect(s).toContain("tornado");
  });

  it("titles the scene and fills the ticker", () => {
    expect(sceneTitle(emergency!)).toBe("TORNADO EMERGENCY · Cleveland, McClain and Oklahoma Counties, OK · until 8:30 PM CDT");
    const t = ticker(activeWarnings(features, NOW));
    expect(t.startsWith("2 Tornado Warnings")).toBe(true);
    expect(t).toContain("Creek County, OK until 8:15 PM CDT");
    expect(ticker([])).toMatch(/^No tornado/);
  });

  it("announces tornado warnings and the most serious storms, not every warning", () => {
    const base = { ...emergency!, tags: [] as string[] };
    expect(worthAnnouncing({ ...base, event: "Tornado Warning" })).toBe(true);
    expect(worthAnnouncing({ ...base, event: "Severe Thunderstorm Warning" })).toBe(false);
    expect(worthAnnouncing({ ...base, event: "Severe Thunderstorm Warning", tags: ["DESTRUCTIVE"] })).toBe(true);
    expect(worthAnnouncing({ ...base, event: "Flash Flood Warning" })).toBe(false);
    expect(worthAnnouncing({ ...base, event: "Flash Flood Warning", tags: ["FLASH FLOOD EMERGENCY"] })).toBe(true);
  });
});

describe("cycle", () => {
  const ws = activeWarnings(features, NOW);
  it("shows the country, each warning, then the top one in Professional mode", () => {
    expect(cycle(ws).map((s) => s.kind)).toEqual(["national", "warning", "warning", "pro"]);
    expect(cycle(ws).at(-1)).toMatchObject({ kind: "pro", warning: ws[0] });
  });
  it("takes turns between the country and Professional mode when it's quiet", () => {
    expect(cycle([]).map((s) => s.kind)).toEqual(["national", "pro"]);
  });
  it("caps how many warnings a cycle visits", () => {
    const many = Array.from({ length: 9 }, (_, i): StreamWarning => ({ ...ws[1]!, key: `k${i}` }));
    expect(cycle(many).filter((s) => s.kind === "warning")).toHaveLength(5);
  });
});

describe("the briefing", () => {
  const ws = activeWarnings(features, NOW);
  const facts = briefingFacts(ws, { risk: "MODERATE", region: "Southern Plains" });

  it("states the counts and the outlook", () => {
    expect(counts(ws)).toBe("2 Tornado Warnings");
    expect(facts).toBe("Right now there are 2 tornado warnings in effect. The Storm Prediction Center has a Moderate Risk of severe storms today, level 4 of 5, for the Southern Plains.");
    expect(briefingFacts([], null)).toBe("Right now there are no tornado, severe thunderstorm or flash flood warnings in effect. The Storm Prediction Center doesn't expect organized severe storms today.");
  });

  it("only lets the AI's version through when it sticks to the facts", () => {
    expect(checkBriefing("Two tornado warnings are out right now, and there's a level 4 of 5 Moderate Risk across the Southern Plains today.", facts)).not.toBeNull();
    expect(checkBriefing("There are 3 tornado warnings right now.", facts)).toBeNull();
    expect(checkBriefing("Watch out for large hail across the Southern Plains.", facts)).toBeNull();
    expect(checkBriefing("Take cover now if you're in Oklahoma.", facts)).toBeNull();
    expect(checkBriefing("", facts)).toBeNull();
  });
});
