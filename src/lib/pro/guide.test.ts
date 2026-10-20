import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ES } from "../i18n/es";
import { GLOSSARY, guideStrings, HOW_TOS, matchesQuery, PRODUCT_GUIDE, productNeeds, TOOL_GUIDE, TOUR } from "./guide";
import { PRO_PRODUCT_IDS } from "./products";

const COMPONENTS = "src/components/pro";
const source = readdirSync(COMPONENTS)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => readFileSync(`${COMPONENTS}/${f}`, "utf8"))
  .join("\n");

describe("Pro guide content", () => {
  it("covers every product and tool", () => {
    for (const id of PRO_PRODUCT_IDS) expect(PRODUCT_GUIDE[id].what, id).toBeTruthy();
    for (const tool of ["inspect", "sounding", "xsect", "vector", "toa", "warngen"] as const) expect(TOOL_GUIDE[tool].steps.length, tool).toBeGreaterThan(0);
  });

  it("badges desktop-only and data-server products", () => {
    expect(productNeeds("vol-ref")).toBe("desktop");
    expect(productNeeds("mrms-mesh")).toBe("server");
    expect(productNeeds("ref")).toBeNull();
  });

  it("has a Spanish translation for every string", () => {
    const ui = [
      "Guide",
      "Professional mode guide",
      "Take the tour",
      "Start",
      "Products",
      "Tools",
      "How to",
      "Glossary",
      "Search the guide",
      "Nothing in the guide matches that.",
      "How to read it",
      "Look for",
      "How to use it",
      "Desktop only",
      "Needs the Pro data server",
      "Hide the guide button",
      "Settings → Professional mode brings it back.",
      "Guide button",
      "Step {n} of {total}",
      "End tour",
    ];
    const missing = [...guideStrings(), ...ui].filter((s) => !ES[s]);
    expect(missing).toEqual([]);
  });

  it("points the tour only at elements the workspace marks", () => {
    for (const step of TOUR) if (step.target) expect(source, step.target).toContain(`data-tour="${step.target}"`);
  });

  it("keeps how-to and glossary entries unique", () => {
    expect(new Set(HOW_TOS.map((h) => h.id)).size).toBe(HOW_TOS.length);
    expect(new Set(GLOSSARY.map((g) => g.term)).size).toBe(GLOSSARY.length);
  });
});

describe("matchesQuery", () => {
  it("needs every word, ignoring case and accents", () => {
    expect(matchesQuery("", "anything")).toBe(true);
    expect(matchesQuery("debris cc", "Tornado debris signature: low CC")).toBe(true);
    expect(matchesQuery("debris hail", "Tornado debris signature")).toBe(false);
    expect(matchesQuery("rotacion", "Velocidad de rotación")).toBe(true);
    expect(matchesQuery("ZDR", "the zdr column")).toBe(true);
  });
});
