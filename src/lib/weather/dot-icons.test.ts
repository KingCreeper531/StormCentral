import { readFileSync } from "node:fs";
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

describe("the Glyph Matrix toy's copy (android/app/src/glyph/.../GlyphArt.java)", () => {
  const java = readFileSync("android/app/src/glyph/java/io/github/kingcreeper531/stormcentral/glyph/GlyphArt.java", "utf8");

  it("draws the same dot icons as the app", () => {
    for (const [name, rows] of Object.entries(DOT_ICONS)) {
      const block = new RegExp(`static final String\\[\\] ${name.toUpperCase().replace(/-/g, "_")} = \\{([^}]*)\\}`).exec(java)?.[1];
      expect(block, name).toBeDefined();
      expect([...block!.matchAll(/"([.#r]+)"/g)].map((m) => m[1]), name).toEqual([...rows]);
    }
  });

  it("maps every weather code to the same icon name as the app", () => {
    const table = /ICON_NAMES = "([^"]+)"/.exec(java)?.[1] ?? "";
    const pairs = new Map(table.split(",").map((p) => [Number(p.split(":")[0]), p.split(":")[1]]));
    for (let code = 0; code <= 99; code++) {
      const info = describeCode(code);
      if (info.label === "—") expect(pairs.has(code), `${code}`).toBe(false);
      else expect(pairs.get(code), `${code} ${info.label}`).toBe(info.icon);
    }
  });
});
