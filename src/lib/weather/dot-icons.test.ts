import { describe, expect, it } from "vitest";
import { DOT_COLS, DOT_ICONS, DOT_ROWS, dotIconFor, dotsOf, type DotIcon } from "./dot-icons";
import { describeCode, iconName } from "./wmo";

describe("dot-grid weather icons", () => {
  it("are all 15 x 11 dots of ink or accent", () => {
    for (const [name, rows] of Object.entries(DOT_ICONS)) {
      expect(rows, name).toHaveLength(DOT_ROWS);
      for (const row of rows) expect(row, name).toMatch(new RegExp(`^[.#r]{${DOT_COLS}}$`));
      expect(dotsOf(name as DotIcon).length, name).toBeGreaterThan(10);
    }
  });

  it("has a matching icon for every weather code, by day and by night", () => {
    const expected: [number, DotIcon, DotIcon][] = [
      [0, "sun", "moon"],
      [2, "sun-cloud", "moon-cloud"],
      [3, "cloud", "cloud"],
      [45, "fog", "fog"],
      [51, "drizzle", "drizzle"],
      [63, "rain", "rain"],
      [65, "heavy-rain", "heavy-rain"],
      [66, "sleet", "sleet"],
      [73, "snow", "snow"],
      [77, "sleet", "sleet"],
      [95, "thunder", "thunder"],
      [96, "thunder", "thunder"],
      [99, "hail", "hail"],
    ];
    for (const [code, day, night] of expected) {
      expect(dotIconFor(iconName(code, true)), `${code} ${describeCode(code).label} by day`).toBe(day);
      expect(dotIconFor(iconName(code, false)), `${code} by night`).toBe(night);
    }
    expect(dotIconFor(iconName(1, true, { gustMs: 20 }))).toBe("wind");
  });

  it("puts lightning, and only lightning, in the accent colour", () => {
    expect(dotsOf("thunder").some(([, , accent]) => accent)).toBe(true);
    expect(dotsOf("rain").some(([, , accent]) => accent)).toBe(false);
  });
});
