import { describe, expect, it } from "vitest";
import { moonIllumination } from "./moon";
import { solunarForecast } from "./solunar";
import { skyPhase, sunCrossings, sunPosition } from "./sun";

describe("moon", () => {
  it("is full at the April 2024 full moon (23 Apr 23:49 UTC)", () => {
    const m = moonIllumination(new Date("2024-04-23T23:49:00Z"));
    expect(m.fraction).toBeGreaterThan(0.98);
    expect(m.name).toBe("Full Moon");
  });

  it("is new at the 8 Apr 2024 eclipse new moon", () => {
    const m = moonIllumination(new Date("2024-04-08T18:21:00Z"));
    expect(m.fraction).toBeLessThan(0.02);
    expect(m.name).toBe("New Moon");
  });

  it("reports a waxing first quarter (15 Apr 2024 19:13 UTC)", () => {
    const m = moonIllumination(new Date("2024-04-15T19:13:00Z"));
    expect(m.fraction).toBeGreaterThan(0.4);
    expect(m.fraction).toBeLessThan(0.6);
    expect(m.waxing).toBe(true);
    expect(m.name).toBe("First Quarter");
  });
});

describe("sun", () => {
  it("is near zenith at equinox noon on the equator", () => {
    const p = sunPosition(new Date("2024-03-20T12:07:00Z"), 0, 0);
    expect(p.altitude).toBeGreaterThan(88);
  });

  it("finds Chicago's solstice sunset (≈ 01:29 UTC)", () => {
    const crossings = sunCrossings(new Date("2024-06-21T18:00:00Z"), 12, 41.8781, -87.6298, -0.833);
    const set = crossings.find((c) => !c.rising);
    expect(set).toBeDefined();
    const expected = Date.parse("2024-06-22T01:29:00Z");
    expect(Math.abs(set!.time.getTime() - expected)).toBeLessThan(5 * 60_000);
  });

  it("classifies sky phases", () => {
    expect(skyPhase(30)).toBe("day");
    expect(skyPhase(3)).toBe("golden");
    expect(skyPhase(-4)).toBe("civil");
    expect(skyPhase(-20)).toBe("night");
  });
});

describe("solunar", () => {
  it("yields two majors and up to two minors per lunar day", () => {
    const f = solunarForecast(new Date("2024-04-23T00:00:00Z"), 25, 41.88, -87.63);
    const majors = f.periods.filter((p) => p.kind === "major");
    const minors = f.periods.filter((p) => p.kind === "minor");
    expect(majors.length).toBeGreaterThanOrEqual(1);
    expect(majors.length).toBeLessThanOrEqual(3);
    expect(minors.length).toBeGreaterThanOrEqual(1);
    expect(f.dayRating).toBe(4); // full moon
    for (const p of f.periods) expect(p.end.getTime()).toBeGreaterThan(p.start.getTime());
  });
});
