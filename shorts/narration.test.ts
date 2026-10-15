import { describe, expect, it } from "vitest";
import { narration, spoken } from "./narration";
import { layout } from "./voice";

describe("spoken", () => {
  it("spells out units, states, days and compass points", () => {
    expect(spoken(`Largest hail: 2.75", near Lubbock, TX.`)).toBe("Largest hail: 2.75 inches, near Lubbock, Texas.");
    expect(spoken(`Strongest gust: 1" and 80 mph`)).toBe("Strongest gust: 1 inch and 80 miles per hour");
    expect(spoken("moving NNW at 12 mph, then NE at 5 mph")).toBe("moving north-northwest at 12 miles per hour, then northeast at 5 miles per hour");
    expect(spoken("By Thu 2 PM, a 15% chance")).toBe("By Thursday 2 PM, a 15 percent chance");
  });
});

describe("narration", () => {
  it("reads the recap from the page's data, in scene order", () => {
    const cues = narration({
      template: "recap.html",
      data: {
        date: "Tuesday, October 13",
        counts: { tornado: 1, wind: 12, hail: 3 },
        highlights: [
          { label: "Largest hail", value: `2"`, place: "Enid, OK", kind: "hail" },
          { label: "Tornado reports", value: "1", place: "KS", kind: "tornado" },
        ],
      },
    });
    expect(cues.map((c) => c.text)).toEqual([
      "Here are the storm reports for Tuesday, October 13.",
      "16 severe weather reports came in: 1 tornado report, 12 damaging wind reports and 3 large hail reports.",
      "Largest hail: 2 inches, near Enid, Oklahoma.",
      "Tornado reports came from Kansas.",
    ]);
    expect(cues.map((c) => c.at)).toEqual([...cues.map((c) => c.at)].sort((a, b) => a - b));
  });

  it("names each day of the week ahead and the busiest one", () => {
    const day = (short: string, n: number, level: number, code: string | null, prob = 0) => ({ label: short, short, n, code, prob, level, risk: code ? "Slight Risk (2 of 5)" : "" });
    const cues = narration({ template: "weekly.html", data: { days: [day("Sun", 1, 0, null), day("Mon", 2, 2, "SLGT"), day("Thu", 5, 2, null, 15)] } });
    expect(cues.map((c) => c.text)).toContain("Monday, Slight Risk.");
    expect(cues.map((c) => c.text)).toContain("Thursday, a 15 percent chance.");
    expect(cues.map((c) => c.text)).toContain("The most active day looks like Monday, with a Slight Risk.");
  });

  it("has nothing to say for an unknown page", () => {
    expect(narration({ template: "nope.html", data: {} })).toEqual([]);
  });
});

describe("layout", () => {
  it("starts each line at its cue unless the one before is still talking", () => {
    expect(layout([{ at: 0.4, text: "a" }, { at: 3, text: "b" }, { at: 4, text: "c" }], [2, 3, 1])).toEqual([0.4, 3, 6.25]);
  });
});
