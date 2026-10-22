import { describe, expect, it } from "vitest";
import type { StormReport } from "../../src/lib/feeds/storm-reports";
import { narration } from "../narration";
import {
  busiestWindow,
  frameTimes,
  isStormDay,
  mosaicTiles,
  radarView,
  reviewScenes,
  reviewTitle,
  stormDays,
  timeline,
  weekDays,
  weekRange,
} from "./review";

const report = (over: Partial<StormReport>): StormReport => ({
  id: Math.random().toString(36),
  time: "2026-05-19T22:00:00Z",
  kind: "hail",
  typeText: "HAIL",
  magnitude: 1.5,
  unit: "INCH",
  measured: null,
  place: "3 NW NORMAN",
  county: null,
  state: "OK",
  source: null,
  remark: null,
  wfo: null,
  lat: 35.2,
  lon: -97.4,
  ...over,
});

// The week of Sunday May 17 to Saturday May 23, 2026 (storm days start at 12Z).
const END = Date.parse("2026-05-24T12:00:00Z");
const START = END - 7 * 86_400_000;
const at = (day: number, h: number) => new Date(START + day * 86_400_000 + h * 3_600_000).toISOString();
const REPORTS: StormReport[] = [
  // Tuesday (day 2): a tornado day in Oklahoma and Kansas, busiest 22Z-02Z.
  report({ kind: "tornado", typeText: "TORNADO", magnitude: null, place: "MOORE", time: at(2, 10), lat: 35.33, lon: -97.48 }),
  report({ kind: "tornado", typeText: "TORNADO", magnitude: null, place: "2 S WICHITA", state: "KS", time: at(2, 11), lat: 37.66, lon: -97.33 }),
  ...Array.from({ length: 12 }, (_, i) => report({ magnitude: 1 + i * 0.25, place: `${i} N ENID`, time: at(2, 9 + i * 0.4), lat: 36.4 + i * 0.05, lon: -97.9 + i * 0.1 })),
  report({ kind: "wind", typeText: "TSTM WND GST", magnitude: 80, unit: "MPH", place: "TULSA", time: at(2, 13), lat: 36.15, lon: -95.99 }),
  // Thursday (day 4): 16 wind reports in Iowa, no tornado.
  ...Array.from({ length: 16 }, (_, i) => report({ kind: "wind-damage", typeText: "TSTM WND DMG", magnitude: null, unit: null, place: `${i} E AMES`, state: "IA", time: at(4, 6 + i * 0.2), lat: 42 + i * 0.03, lon: -93.6 + i * 0.1 })),
  // Friday: a few reports, not a storm day; a flash flood.
  report({ magnitude: 1, place: "DALLAS", state: "TX", time: at(5, 8), lat: 32.78, lon: -96.8 }),
  report({ kind: "flood", typeText: "FLASH FLOOD", magnitude: null, unit: null, place: "AUSTIN", state: "TX", time: at(5, 9), lat: 30.27, lon: -97.74 }),
  // Outside the week.
  report({ kind: "tornado", typeText: "TORNADO", magnitude: null, time: at(7, 3) }),
];

describe("week in review", () => {
  const days = weekDays(REPORTS, END);
  const picked = stormDays(days);

  it("splits the week into seven storm days and finds the storm days, in order", () => {
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.summary.total)).toEqual([0, 0, 15, 0, 16, 1, 0]);
    expect(days[5]!.floods).toBe(1);
    expect(days.map(isStormDay)).toEqual([false, false, true, false, true, false, false]);
    expect(picked.map((d) => new Date(d.start).toISOString().slice(0, 10))).toEqual(["2026-05-19", "2026-05-21"]);
  });

  it("loops the radar over the busiest hours, on the archive's 5-minute marks", () => {
    const [a, b] = busiestWindow(days[2]!.reports.map((r) => r.time));
    expect(b - a).toBe(6 * 3_600_000);
    expect(a % 300_000).toBe(0);
    for (const r of days[2]!.reports) expect(r.time >= a && r.time <= b).toBe(true);
    expect(frameTimes([a, b])).toHaveLength(19);
    expect(mosaicTiles(Date.parse("2026-05-19T22:05:00Z"))).toBe("https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-202605192205/{z}/{x}/{y}.png");
  });

  it("frames the reports in the page's radar box, with tiles that cover it", () => {
    const v = radarView(days[2]!.reports);
    for (const r of days[2]!.reports) {
      expect(r.lon).toBeGreaterThan(v.west);
      expect(r.lon).toBeLessThan(v.east);
      expect(r.lat).toBeGreaterThan(v.south);
      expect(r.lat).toBeLessThan(v.north);
    }
    // Web Mercator width:height matches the 1180x800 box.
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    expect(((v.east - v.west) * Math.PI) / 180 / (merc(v.north) - merc(v.south))).toBeCloseTo(1180 / 800, 3);
    expect((v.x1 - v.x0 + 1) * (v.y1 - v.y0 + 1)).toBeLessThanOrEqual(30);
    expect(v.z).toBeGreaterThanOrEqual(5);
  });

  it("names the week, and writes the scenes and lines from the reports", () => {
    expect(weekRange(START)).toBe("May 17–23, 2026");
    expect(weekRange(Date.parse("2026-09-27T12:00:00Z"))).toBe("Sep 27 – Oct 3, 2026");
    const scenes = reviewScenes(days, picked, null, weekRange(START));
    expect(scenes.map((s) => s.type)).toEqual(["intro", "overview", "day", "day", "intro"]);
    expect(scenes.map((s) => s.title)).toEqual(["Intro", "The week", "Tuesday, May 19", "Thursday, May 21", "That's the week"]);
    const lines = scenes.flatMap((s) => s.beats.map((b) => b.say));
    expect(lines[0]).toBe("Here's your weather week in review, for May 17 to 23.");
    expect(lines).toContain("32 severe weather reports came in this week: 2 tornado reports, 17 damaging wind reports and 13 large hail reports.");
    expect(lines).toContain("The busiest day was Thursday, with 16 reports.");
    expect(lines).toContain("There was also 1 flood report.");
    expect(lines).toContain("Tuesday: storms hit Oklahoma and Kansas.");
    expect(lines).toContain("Tornado reports came from Oklahoma and Kansas.");
    expect(lines).toContain("The largest hail was 3.75 inches, near Enid, OK.");
    expect(lines).toContain("The strongest gust was 80 mph, near Tulsa, OK.");
    expect(reviewTitle(weekRange(START), days, null)).toBe("Weather Week in Review: May 17–23, 2026 | 2 Tornado Reports, Hail to 3.75 in");
  });

  it("gives every storm day at least 18 seconds of radar, and times the narration to the beats", () => {
    const tl = timeline(reviewScenes(days, picked, null, weekRange(START)));
    for (const c of tl.chapters.filter((x) => x.type === "day")) expect(c.end - c.start).toBeGreaterThanOrEqual(18);
    const cues = narration({ template: "review.html", data: { beats: tl.beats } });
    expect(cues).toHaveLength(tl.beats.length);
    expect(cues[0]!.at).toBeCloseTo(0.3);
    // spoken(): units and state codes read out.
    expect(cues.map((c) => c.text)).toContain("The strongest gust was 80 miles per hour, near Tulsa, Oklahoma.");
  });
});
