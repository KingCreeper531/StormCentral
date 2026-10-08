import { describe, expect, it } from "vitest";
import { parseWindow, scoreReport, summarize, type ModelSnapshot, type ScorableReport } from "./scorecard";

const snap = (s: Partial<ModelSnapshot> = {}): ModelSnapshot => ({ tempC: 12, code: 3, windMs: 4, gustMs: 7, ...s });

let seq = 0;
const report = (category: string, conditions: ModelSnapshot | null, extra: Partial<ScorableReport> = {}): ScorableReport => ({
  id: `p${++seq}`,
  category,
  severity: 0,
  createdAt: 1_000 + seq,
  place: "Norman, OK",
  username: "spotter",
  conditions,
  ...extra,
});

describe("scoreReport", () => {
  it("scores rain and flooding against wet weather codes", () => {
    for (const code of [51, 55, 61, 65, 66, 80, 82, 95, 99]) expect(scoreReport("rain", snap({ code }))).toBe(true);
    for (const code of [0, 3, 45, 71, 85]) expect(scoreReport("flooding", snap({ code }))).toBe(false);
  });

  it("counts precipitation amount or probability as a rain hit when present", () => {
    expect(scoreReport("rain", snap({ code: 3, precipMm: 0.5 }))).toBe(true);
    expect(scoreReport("rain", snap({ code: 3, precipMm: 0.2 }))).toBe(false);
    expect(scoreReport("flooding", snap({ code: 2, precipProb: 50 }))).toBe(true);
    expect(scoreReport("flooding", snap({ code: 2, precipProb: 49 }))).toBe(false);
    // Precipitation fields alone are enough to score when the code is missing.
    expect(scoreReport("rain", snap({ code: null, precipProb: 80 }))).toBe(true);
    expect(scoreReport("rain", snap({ code: null }))).toBeNull();
  });

  it("scores snow against snow and freezing codes", () => {
    for (const code of [71, 73, 75, 77, 85, 86, 56, 67]) expect(scoreReport("snow", snap({ code }))).toBe(true);
    for (const code of [3, 61, 95]) expect(scoreReport("snow", snap({ code }))).toBe(false);
  });

  it("scores hail, lightning and tornado against thunderstorm codes only", () => {
    for (const cat of ["hail", "lightning", "tornado"]) {
      for (const code of [95, 96, 99]) expect(scoreReport(cat, snap({ code }))).toBe(true);
      for (const code of [3, 65, 82]) expect(scoreReport(cat, snap({ code }))).toBe(false);
    }
  });

  it("scores wind against gust and sustained thresholds", () => {
    expect(scoreReport("wind", snap({ gustMs: 15, windMs: 5 }))).toBe(true);
    expect(scoreReport("wind", snap({ gustMs: 14.9, windMs: 11 }))).toBe(true);
    expect(scoreReport("wind", snap({ gustMs: 14.9, windMs: 10.9 }))).toBe(false);
    expect(scoreReport("wind", snap({ gustMs: null, windMs: 12 }))).toBe(true);
    // The weather code doesn't matter for wind.
    expect(scoreReport("wind", snap({ code: 95, gustMs: 8, windMs: 4 }))).toBe(false);
    expect(scoreReport("wind", snap({ gustMs: null, windMs: null }))).toBeNull();
  });

  it("scores fog against codes 45 and 48", () => {
    expect(scoreReport("fog", snap({ code: 45 }))).toBe(true);
    expect(scoreReport("fog", snap({ code: 48 }))).toBe(true);
    expect(scoreReport("fog", snap({ code: 3 }))).toBe(false);
  });

  it("does not score observations, sky photos, unknown categories or missing snapshots", () => {
    expect(scoreReport("observation", snap({ code: 95 }))).toBeNull();
    expect(scoreReport("sky", snap())).toBeNull();
    expect(scoreReport("volcano", snap())).toBeNull();
    expect(scoreReport("hail", null)).toBeNull();
    expect(scoreReport("hail", snap({ code: null }))).toBeNull();
  });

  it("scores old snapshots without precipitation fields", () => {
    const legacy = JSON.parse('{"tempC":20,"code":63,"windMs":3,"gustMs":6}') as ModelSnapshot;
    expect(scoreReport("rain", legacy)).toBe(true);
  });
});

describe("summarize", () => {
  const rows: ScorableReport[] = [
    report("hail", snap({ code: 96 })),
    report("hail", snap({ code: 3 }), { severity: 3, createdAt: 50_000, place: "Moore, OK" }),
    report("hail", null),
    report("wind", snap({ gustMs: 20 })),
    report("wind", snap({ gustMs: 8, windMs: 3 }), { severity: 2, createdAt: 60_000 }),
    report("wind", snap({ gustMs: 8, windMs: 3 }), { severity: 1, createdAt: 70_000 }),
    report("fog", snap({ code: 45 })),
    report("observation", snap({ code: 95 })),
    report("sky", null),
  ];
  const s = summarize(rows, { days: 30, since: 0, now: 99 });

  it("tallies per category and overall", () => {
    const hail = s.categories.find((c) => c.category === "hail")!;
    expect(hail).toEqual({ category: "hail", reports: 3, scored: 2, hits: 1, hitRate: 0.5 });
    const wind = s.categories.find((c) => c.category === "wind")!;
    expect(wind).toMatchObject({ reports: 3, scored: 3, hits: 1 });
    expect(wind.hitRate).toBeCloseTo(1 / 3);
    expect(s.categories.find((c) => c.category === "tornado")).toEqual({ category: "tornado", reports: 0, scored: 0, hits: 0, hitRate: null });
    expect(s.overall).toEqual({ reports: 7, scored: 6, hits: 3, hitRate: 0.5 });
    expect(s.unscoredReports).toBe(2);
    expect(s.days).toBe(30);
    expect(s.generatedAt).toBe(99);
  });

  it("lists significant misses newest first with the model's conditions", () => {
    expect(s.misses.map((m) => [m.category, m.severity, m.createdAt])).toEqual([
      ["wind", 2, 60_000],
      ["hail", 3, 50_000],
    ]);
    expect(s.misses[1]).toMatchObject({ place: "Moore, OK", username: "spotter", model: { code: 3, windMs: 4, gustMs: 7, tempC: 12 } });
  });

  it("caps the misses list", () => {
    const many = Array.from({ length: 15 }, (_, i) => report("tornado", snap({ code: 3 }), { severity: 3, createdAt: i }));
    expect(summarize(many, { days: 7, since: 0 }).misses).toHaveLength(10);
    expect(summarize(many, { days: 7, since: 0, missLimit: 3 }).misses.map((m) => m.createdAt)).toEqual([14, 13, 12]);
  });

  it("handles an empty window", () => {
    const empty = summarize([], { days: 90, since: 0 });
    expect(empty.overall).toEqual({ reports: 0, scored: 0, hits: 0, hitRate: null });
    expect(empty.misses).toEqual([]);
    expect(empty.categories).toHaveLength(8);
  });
});

describe("parseWindow", () => {
  it("accepts 7, 30 and 90 days and defaults to 30", () => {
    expect(parseWindow(null)).toBe(30);
    expect(parseWindow("")).toBe(30);
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow("90")).toBe(90);
  });

  it("rejects anything else", () => {
    for (const bad of ["14", "abc", "7.5", "-7", " 7", "1e1", "030x"]) expect(parseWindow(bad)).toBeNull();
  });
});
