import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glossaryFor, parseAfd, plain } from "./afd";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("parseAfd", () => {
  it("leads with an office's key messages and keeps what changed", () => {
    const r = parseAfd(fixture("afd-pbz.txt"));
    expect(r.officeName).toBe("Pittsburgh PA");
    expect(r.summary?.kind).toBe("key-messages");
    expect(r.summary?.items).toHaveLength(2);
    expect(r.summary?.items[0]).toMatch(/^Unseasonably warm on Tuesday; near record high temperatures\. Rain chances/);
    expect(r.changes).toEqual(["Little change in messaging with latest round of model guidance."]);
  });

  it("splits sections, drops the alert list, and spells out shorthand", () => {
    const r = parseAfd(fixture("afd-pbz.txt"));
    expect(r.sections.map((s) => s.id)).toEqual(["discussion", "aviation"]);
    const disc = r.sections[0]!;
    expect(disc.specialty).toBe(false);
    // "KEY MESSAGE 1..." sub-headings are stripped from the paragraphs.
    expect(disc.paragraphs[0]).toMatch(/^Height rises aloft/);
    const aviation = r.sections[1]!;
    expect(aviation.specialty).toBe(true);
    expect(aviation.period).toBe("18Z Monday through Saturday");
    expect(aviation.paragraphs[0]).toContain("cloud ceilings are expected");
    expect(r.sections.some((s) => /watches/i.test(s.title))).toBe(false);
  });

  it("falls back to the synopsis and tidies headings and time stamps", () => {
    const r = parseAfd(fixture("afd-lox.txt"));
    expect(r.officeName).toBe("Los Angeles/Oxnard CA");
    expect(r.summary?.kind).toBe("synopsis");
    expect(r.summary?.items[0]).toMatch(/^Minor to moderate coastal flooding/);
    const ids = r.sections.map((s) => s.id);
    expect(ids.slice(0, 2)).toEqual(["short-term", "long-term"]);
    expect(ids).not.toContain("synopsis");
    expect(r.sections[0]!.period).toBe("Today to Wed");
    const aviation = r.sections.find((s) => s.id === "aviation")!;
    expect(aviation.paragraphs[0]).toMatch(/^At 18Z at KLAX/);
    // Update banners are not content.
    expect(r.sections[0]!.paragraphs.join(" ")).not.toContain("***");
    expect(r.glossary.map((g) => g.term)).toContain("Santa Ana winds");
  });

  it("reads mixed-case periods, period lines and drops update stamps", () => {
    const text = [
      "National Weather Service Norman OK",
      "",
      ".KEY MESSAGES...",
      "Updated at 1235 PM CDT Mon Oct 12 2026",
      "",
      "- Remaining unseasonably hot through Tuesday.",
      "",
      "&&",
      "",
      ".SHORT TERM /Through Wednesday Night/...",
      "The closed upper level low center is overhead.",
      "",
      "&&",
      "",
      ".NEAR TERM...",
      "(Rest of today and tonight)",
      "Issued 1148 AM MDT MON OCT 12 2026",
      "",
      "Hot and breezy.",
      "",
      "-JAR",
      "",
      "&&",
      "",
      ".PRELIMINARY POINT TEMPS/POPS...",
      "Houston (IAH)   77  92  77  92 /  30  60  20  10",
      "",
      "$$",
    ].join("\n");
    const r = parseAfd(text);
    expect(r.summary?.items).toEqual(["Remaining unseasonably hot through Tuesday."]);
    expect(r.sections.map((s) => [s.id, s.period, s.paragraphs])).toEqual([
      ["short-term", "Through Wednesday night", ["The closed upper level low center is overhead."]],
      ["near-term", "Rest of today and tonight", ["Hot and breezy."]],
    ]);
  });

  it("returns an empty result for text that isn't a discussion", () => {
    const r = parseAfd("nothing here");
    expect(r.summary).toBeNull();
    expect(r.sections).toEqual([]);
  });
});

describe("plain", () => {
  it("expands shorthand and fixes all-caps paragraphs", () => {
    expect(plain("TSTMS POSSIBLE THIS AFTERNOON WITH GUSTY WINDS AND LOW CIGS.")).toBe("Thunderstorms possible this afternoon with gusty winds and low cloud ceilings.");
    expect(plain("Winds 20 kts thru the evening...then calmer.")).toBe("Winds 20 knots through the evening…then calmer.");
  });

  it("finds jargon in the text", () => {
    expect(glossaryFor("A shortwave trough and ample CAPE").map((g) => g.term)).toEqual(["Shortwave", "Trough", "CAPE"]);
  });
});
