import { describe, expect, it } from "vitest";
import { monotonePath, niceTicks, roundedBar, segments } from "./charts";

describe("charts", () => {
  it("builds monotone paths that pass through every point", () => {
    const d = monotonePath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }]);
    expect(d.startsWith("M0.00,0.00")).toBe(true);
    expect(d).toContain("10.00,10.00");
    expect(d.endsWith("20.00,5.00")).toBe(true);
  });

  it("splits series on gaps", () => {
    const s = segments([0, 1, 2, 3], [1, null, 3, 4], (x) => x, (y) => y);
    expect(s.map((r) => r.length)).toEqual([1, 2]);
  });

  it("makes nice ticks", () => {
    expect(niceTicks(3, 97, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it("draws nothing for empty bars", () => {
    expect(roundedBar(0, 0, 10, 0)).toBe("");
    expect(roundedBar(0, 0, 10, 20)).toMatch(/^M0,20V4Q/);
  });
});
