import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawAlertFeature } from "../src/lib/alerts";
import { checkAgainst } from "./analysis";
import { haversineKm } from "../src/lib/geo";
import {
  activeWarnings,
  annotateWarning,
  announcement,
  briefingFacts,
  clipText,
  countsOf,
  cycle,
  isMajor,
  liveTitle,
  outlookBadge,
  placeOf,
  sceneText,
  strengthened,
  tickerItems,
  worthAnnouncing,
  type StreamWarning,
} from "./plan";

const NOW = Date.parse("2026-05-21T00:55:00Z");
const features = (JSON.parse(readFileSync("shorts/fixtures/breaking/tornado-emergency/nws-active.json", "utf8")) as { features: RawAlertFeature[] }).features;

describe("the stream's own drawing", () => {
  const motion = { headingDeg: 45, speedKt: 30, positions: [[-97.5, 35.2]] as [number, number][], time: "2026-05-21T00:45:00Z" };

  it("rings the storm where it is now and points to where it'll be in 30 minutes", () => {
    const [ring, arrow, label] = annotateWarning({ motion }, NOW);
    expect(ring!.kind).toBe("circle");
    expect(arrow!.kind).toBe("arrow");
    const [a, b] = arrow!.points;
    const at = (p: [number, number]) => ({ lon: p[0], lat: p[1] });
    // 10 minutes on from the warning's position at 30 kt, then 30 minutes ahead.
    expect(haversineKm({ lat: 35.2, lon: -97.5 }, at(a!))).toBeCloseTo(30 * 1.852 / 6, 1);
    expect(haversineKm(at(a!), at(b!))).toBeCloseTo(30 * 1.852 / 2, 1);
    expect(label).toMatchObject({ kind: "text", text: "35 MPH" });
  });

  it("draws nothing without a motion", () => {
    expect(annotateWarning({ motion: null }, NOW)).toEqual([]);
    expect(annotateWarning({ motion: { ...motion, speedKt: 0 } }, NOW)).toEqual([]);
  });
});

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
  it("stays on a major tornado: its warning and Professional mode take turns", () => {
    expect(isMajor(ws[0]!)).toBe(true);
    const c = cycle(ws);
    expect(c.map((s) => s.kind)).toEqual(["warning", "pro", "national", "warning", "pro"]);
    expect(c.filter((s) => s.kind === "pro").every((s) => s.kind === "pro" && s.warning === ws[0])).toBe(true);
    const pro = c.filter((s) => s.kind === "pro").reduce((n, s) => n + s.seconds, 0);
    expect(pro / c.reduce((n, s) => n + s.seconds, 0)).toBeGreaterThan(0.45);
  });
  it("otherwise shows the country, each warning, then the top one in Professional mode", () => {
    const radarIndicated = ws.map((w) => ({ ...w, level: "tornado" as const, chips: ["TORNADO RADAR INDICATED"] }));
    expect(isMajor(radarIndicated[0]!)).toBe(false);
    expect(cycle(radarIndicated).map((s) => s.kind)).toEqual(["national", "warning", "warning", "pro"]);
    expect(cycle(radarIndicated).at(-1)).toMatchObject({ kind: "pro", warning: radarIndicated[0], seconds: 90 });
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
    expect(facts).toBe("Right now there are 2 tornado warnings in effect. The Storm Prediction Center has a Moderate Risk of severe storms today, level 4 of 5, for the Southern Plains.");
    expect(briefingFacts([], null)).toBe("Right now there are no tornado, severe thunderstorm or flash flood warnings in effect. The Storm Prediction Center doesn't expect organized severe storms today.");
  });

  it("only lets the AI's version through when it sticks to the facts", () => {
    const check = (t: string) => checkAgainst(t, facts, { maxWords: 50 });
    expect(check("Two tornado warnings are out right now, and there's a level 4 of 5 Moderate Risk across the Southern Plains today.")).not.toBeNull();
    expect(check("There are 3 tornado warnings right now.")).toBeNull();
    expect(check("Three tornado warnings are out right now.")).toBeNull();
    expect(check("Watch out for large hail across the Southern Plains.")).toBeNull();
    expect(check("Take cover now if you're in Oklahoma.")).toBeNull();
    expect(check("")).toBeNull();
  });
});

describe("the stream's graphics", () => {
  const ws = activeWarnings(features, NOW);

  it("gives each warning its sound level, colour and impact chips", () => {
    expect(ws[0]).toMatchObject({ level: "emergency", color: "#ff2bd6" });
    expect(ws[0]!.chips.some((c) => c.startsWith("TORNADO"))).toBe(true);
    expect(ws[1]).toMatchObject({ level: "tornado", color: "#ff3b3b" });
  });

  it("splits the lower third into the warning and where it is", () => {
    expect(sceneText(ws[1]!)).toEqual({ title: "TORNADO WARNING", subtitle: "Creek County, OK · until 8:15 PM CDT" });
  });

  it("counts by kind and lists the ticker with codes", () => {
    expect(countsOf(ws)).toEqual([{ code: "TOR", label: "Tornado", color: "#ff3b3b", n: 2 }]);
    expect(tickerItems(ws).map((t) => t.code)).toEqual(["EMERG", "TOR"]);
    expect(outlookBadge({ risk: "ENHANCED", region: "" })).toEqual({ label: "ENHANCED RISK", color: "#f2b25c" });
    expect(outlookBadge(null)).toBeNull();
  });
});

describe("the live title", () => {
  const ws = activeWarnings(features, NOW);
  const tor = ws[1]!;

  it("leads with an emergency, named where the warning says the storm is", () => {
    expect(placeOf(ws[0]!)).toBe("Moore, OK");
    expect(placeOf(tor)).toMatch(/^[A-Z][a-z]+, OK$/);
    expect(liveTitle(ws, null)).toBe("TORNADO EMERGENCY: Moore, OK • Live Radar | Storm Central");
  });

  it("says when a storm strengthened: a tornado warning where a severe storm warning was", () => {
    const svr: StreamWarning = { ...tor, key: "KTSA.SV.W.80.2026", event: "Severe Thunderstorm Warning", name: "Severe Thunderstorm Warning", rank: 10, level: "severe" };
    const up = strengthened([svr], [tor], NOW);
    expect(up).toEqual([{ warning: tor, why: "now a Tornado Warning", at: NOW }]);
    expect(liveTitle([tor], null, up, NOW)).toBe(`Watching a strengthening storm near ${placeOf(tor)}: now a Tornado Warning • Live | Storm Central`);
    // Half an hour on, it's just a tornado warning again.
    expect(liveTitle([tor], null, up, NOW + 31 * 60_000)).toBe(`Tornado Warning near ${placeOf(tor)} • Live Storm Tracking | Storm Central`);
  });

  it("notices an upgrade of the same warning", () => {
    const observed = { ...tor, rank: tor.rank + 10, tags: ["OBSERVED"] };
    expect(strengthened([tor], [observed], NOW)[0]!.why).toBe("tornado observed");
    expect(strengthened([tor], [tor], NOW)).toEqual([]);
  });

  it("falls back to severe storms, SPC's risk, then the 24/7 title, always within YouTube's 100 characters", () => {
    const svr = { ...tor, event: "Severe Thunderstorm Warning" as const, name: "Severe Thunderstorm Warning", level: "severe" as const };
    expect(liveTitle([svr], null)).toBe("Severe Storms in Oklahoma • 1 Warning • Live Radar | Storm Central");
    expect(liveTitle([], { risk: "MODERATE", region: "Southern Plains" })).toBe("Moderate Risk of Severe Storms Today for the Southern Plains • 24/7 Live Radar | Storm Central");
    expect(liveTitle([], { risk: "MARGINAL", region: "" })).toMatch(/^24\/7 Live Weather Radar/);
    for (const t of [liveTitle(ws, null), liveTitle([svr], null), liveTitle([], null)]) expect(t.length).toBeLessThanOrEqual(100);
  });

  it("never puts an emoji in a title (the owner asked for none)", () => {
    const svr = { ...tor, event: "Severe Thunderstorm Warning" as const, name: "Severe Thunderstorm Warning", level: "severe" as const };
    const up = strengthened([svr], [tor], NOW);
    const titles = [
      liveTitle(ws, null),
      liveTitle([tor], null, up, NOW),
      liveTitle([tor], null),
      liveTitle([svr], null),
      liveTitle([], { risk: "HIGH", region: "Southern Plains" }),
      liveTitle([], null),
      ...ws.map((w) => clipText(w, "https://youtu.be/abc").title),
    ];
    for (const t of titles) expect(t, t).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("writes a clip's title and description from the warning", () => {
    const c = clipText(ws[0]!, "https://youtu.be/abc");
    expect(c.title).toMatch(/^Tornado Emergency: .+#shorts$/);
    expect(c.title.length).toBeLessThanOrEqual(100);
    expect(c.description).toContain("Watch the live stream: https://youtu.be/abc");
    expect(c.description).toContain("Not an official warning source");
  });
});
