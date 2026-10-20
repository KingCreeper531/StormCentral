import { describe, expect, it } from "vitest";
import { ALERTS } from "./es/alerts";
import { COMMON } from "./es/common";
import { COMMUNITY } from "./es/community";
import { DAILY } from "./es/daily";
import { GUIDE } from "./es/guide";
import { LIB } from "./es/lib";
import { MAP } from "./es/map";
import { MODES } from "./es/modes";
import { NOTIFY } from "./es/notify";
import { PRO } from "./es/pro";
import { RADAR } from "./es/radar";
import { SETTINGS } from "./es/settings";
import { SHELL } from "./es/shell";

const AREAS = { ALERTS, COMMON, COMMUNITY, DAILY, GUIDE, LIB, MAP, MODES, NOTIFY, PRO, RADAR, SETTINGS, SHELL };
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Spanish dictionaries", () => {
  it("never give one English key two different translations", () => {
    const seen = new Map<string, { area: string; es: string }>();
    const conflicts: string[] = [];
    for (const [area, dict] of Object.entries(AREAS)) {
      for (const [en, es] of Object.entries(dict)) {
        const prev = seen.get(en);
        if (prev && prev.es !== es) conflicts.push(`"${en}": ${prev.area} "${prev.es}" vs ${area} "${es}"`);
        else seen.set(en, { area, es });
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("keep every {placeholder} and leave nothing empty", () => {
    const bad: string[] = [];
    for (const [area, dict] of Object.entries(AREAS)) {
      for (const [en, es] of Object.entries(dict)) {
        if (!es.trim()) bad.push(`${area}: "${en}" is empty`);
        else if (placeholders(en).join() !== placeholders(es).join()) bad.push(`${area}: "${en}" → "${es}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});
