import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawAlertFeature } from "../src/lib/alerts";
import type { StormReport } from "../src/lib/feeds/storm-reports";
import { checkAgainst, commentaryFacts, direction, notable, reportSentence, reportsNear, stormFacts, type Place } from "./analysis";
import { writeChecked, type Writer } from "./llm";
import { activeWarnings } from "./plan";

const NOW = Date.parse("2026-05-21T00:55:00Z");
const features = (JSON.parse(readFileSync("shorts/fixtures/breaking/tornado-emergency/nws-active.json", "utf8")) as { features: RawAlertFeature[] }).features;
const [emergency] = activeWarnings(features, NOW);
const PLACES: Place[] = [
  { name: "Moore", state: "OK", lat: 35.339, lon: -97.487, pop: 62000 },
  { name: "Norman", state: "OK", lat: 35.222, lon: -97.439, pop: 128000 },
  { name: "Oklahoma City", state: "OK", lat: 35.468, lon: -97.516, pop: 681000 },
  { name: "Midwest City", state: "OK", lat: 35.45, lon: -97.397, pop: 58000 },
  { name: "Tulsa", state: "OK", lat: 36.154, lon: -95.993, pop: 411000 },
];

describe("stormFacts", () => {
  it("places the storm from the warning's own position and motion, and the towns in its path", () => {
    expect(emergency!.motion).not.toBeNull();
    const f = stormFacts(emergency!, PLACES, NOW);
    expect(f.near).toMatch(/^(over|\d+ miles \w+ of) [A-Z][\w ]+, OK$/);
    expect(f.moving).toMatch(/^moving \w+ at \d+ mph$/);
    for (const a of f.ahead) {
      expect(a.minutes).toBeGreaterThan(2);
      expect(a.minutes).toBeLessThanOrEqual(90);
      expect(a.at).toMatch(/Central time$/);
    }
    // Soonest first.
    expect(f.ahead.map((a) => a.minutes)).toEqual([...f.ahead.map((a) => a.minutes)].sort((x, y) => x - y));
  });

  it("works without towns or motion", () => {
    const f = stormFacts({ ...emergency!, motion: null }, [], NOW);
    expect(f).toMatchObject({ near: null, moving: null, ahead: [], at: { lat: emergency!.lat, lon: emergency!.lon } });
  });

  it("names compass directions", () => {
    expect([0, 44, 46, 180, 225, 359].map(direction)).toEqual(["north", "northeast", "northeast", "south", "southwest", "north"]);
  });
});

describe("storm reports", () => {
  const report = (o: Partial<StormReport>): StormReport => ({
    id: "1", time: "2026-05-21T00:52:00Z", kind: "tornado", typeText: "TORNADO", magnitude: null, unit: null, measured: null,
    place: "3 SW MOORE", county: "Cleveland", state: "OK", source: "TRAINED SPOTTER", remark: null, wfo: "OUN", lat: 35.31, lon: -97.52, ...o,
  });

  it("reads a report as a sentence in the storm's own time zone", () => {
    expect(reportSentence(report({}), "America/Chicago")).toBe("Trained spotter reported a tornado 3 miles southwest of Moore, OK at 7:52 PM Central time.");
    expect(reportSentence(report({ kind: "hail", magnitude: 2.75, place: "NORMAN" }), "America/Chicago")).toMatch(/reported 2\.75-inch hail near Norman, OK/);
  });

  it("keeps the notable ones near the storm in the last hour", () => {
    expect(notable(report({ kind: "hail", magnitude: 1 }))).toBe(false);
    expect(notable(report({ kind: "wind", magnitude: 70 }))).toBe(true);
    const near = reportsNear([report({}), report({ id: "2", lat: 37, lon: -95 }), report({ id: "3", time: "2026-05-20T22:00:00Z" })], { lat: 35.33, lon: -97.5 }, NOW);
    expect(near.map((r) => r.id)).toEqual(["1"]);
  });

  it("puts everything known into the commentary's facts", () => {
    const lines = commentaryFacts(emergency!, stormFacts(emergency!, PLACES, NOW), [report({})]);
    expect(lines[0]).toMatch(/^Tornado Emergency for Cleveland, McClain and Oklahoma counties in Oklahoma, until/);
    expect(lines.some((l) => l.startsWith("The National Weather Service says:"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^Trained spotter reported a tornado/);
  });
});

describe("checkAgainst", () => {
  const facts = "Tornado Warning for Creek County in Oklahoma, until 8:15 PM Central time. The storm is 6 miles west of Bristow, OK, moving northeast at 35 mph. On its current path it would reach Bristow, OK around 7:58 PM Central time.";

  it("lets through a rewording that sticks to the facts", () => {
    expect(checkAgainst("The tornado-warned storm is 6 miles west of Bristow, moving northeast at 35 mph, and would reach Bristow around 7:58 PM.", facts)).not.toBeNull();
  });

  it("throws out invented numbers, places, hazards and advice", () => {
    expect(checkAgainst("The storm is 10 miles west of Bristow.", facts)).toBeNull();
    expect(checkAgainst("The storm will reach Sapulpa around 7:58 PM.", facts)).toBeNull();
    expect(checkAgainst("Radar shows strong rotation west of Bristow.", facts)).toBeNull();
    expect(checkAgainst("People in Bristow should take cover now.", facts)).toBeNull();
    expect(checkAgainst("word ".repeat(80), facts)).toBeNull();
  });

  it("checks a town name that starts a sentence too", () => {
    expect(checkAgainst("Moving northeast at 35 mph. Sapulpa is next in its path.", facts)).toBeNull();
    expect(checkAgainst("Bristow is in its path. It would arrive around 7:58 PM.", facts)).not.toBeNull();
  });
});

describe("writeChecked", () => {
  const writer = (name: string, text: string | Error): Writer => ({ name, write: async () => { if (text instanceof Error) throw text; return text; } });

  it("takes the best writer whose text passes, and falls back down the list", async () => {
    const check = (t: string) => (t.includes("ok") ? t : null);
    expect(await writeChecked([writer("A", "fine and ok"), writer("B", "ok too")], "s", "p", check)).toEqual({ text: "fine and ok", by: "A" });
    expect(await writeChecked([writer("A", new Error("down")), writer("B", "invented"), writer("C", "  \"ok\" ")], "s", "p", check)).toEqual({ text: "ok", by: "C" });
    expect(await writeChecked([writer("A", "nope")], "s", "p", check)).toBeNull();
    expect(await writeChecked([], "s", "p", check)).toBeNull();
  });
});
