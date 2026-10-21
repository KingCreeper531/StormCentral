import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// common.js is browser code: run it with the vendored d3 and topojson, and stubs for the canvas and logo.
type Pt = [number, number];
type Box = [Pt, Pt];
interface Projection {
  (lonlat: Pt): Pt | null;
  locate(lonlat: Pt): { xy: Pt; part: number } | null;
  parts: { projection: { invert(p: Pt): Pt | null }; box: Box | null }[];
}
interface Feature {
  id: string;
  geometry: { type: string; coordinates: unknown };
}
const read = (f: string) => readFileSync(`shorts/${f}`, "utf8");
const states = JSON.parse(read("vendor/states-10m.json"));
const sandbox: Record<string, unknown> = {
  DATA: { states, logo: "" },
  document: { getElementById: () => ({ getContext: () => ({}) }) },
  Image: class {},
};
sandbox.window = sandbox;
sandbox.self = sandbox;
for (const f of ["vendor/d3-array.min.js", "vendor/d3-geo.min.js", "vendor/topojson-client.min.js", "common.js"]) runInNewContext(read(f), sandbox);
const SC = sandbox.SC as { usProjection(): Projection; usa: { features: Feature[] }; conus: { features: Feature[] } };
interface Conic {
  parallels(p: Pt): Conic;
  rotate(r: Pt): Conic;
  fitExtent(e: Box, o: unknown): Conic;
  (p: Pt): Pt;
}
const d3 = sandbox.d3 as { geoConicConformal(): Conic; geoContains(f: Feature, p: Pt): boolean; geoBounds(f: Feature): Box };

const us = SC.usProjection();
const [, AK, HI] = us.parts;
const within = ([x, y]: Pt, [[x0, y0], [x1, y1]]: Box) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const vertices = (f: Feature): Pt[] => {
  const out: Pt[] = [];
  const walk = (c: unknown) => (Array.isArray(c) && typeof c[0] === "number" ? out.push(c as Pt) : Array.isArray(c) && c.forEach(walk));
  walk(f.geometry.coordinates);
  return out;
};

describe("the Shorts' US map", () => {
  // Hundreds of thousands of vertices: mismatches are collected and checked once (an expect each is too slow for CI).
  it("puts every point of Alaska and Hawaii in its inset", () => {
    const wrong: string[] = [];
    for (const [id, part, box] of [["02", 1, AK!.box!], ["15", 2, HI!.box!]] as const) {
      const f = SC.usa.features.find((s) => s.id === id)!;
      for (const v of vertices(f)) {
        const at = us.locate(v);
        if (at?.part !== part || !within(at.xy, [[box[0][0] - 1, box[0][1] - 1], [box[1][0] + 1, box[1][1] + 1]])) wrong.push(`${id} ${v}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(us.locate([-149.9, 61.22])?.part).toBe(1); // Anchorage
    expect(us.locate([-157.86, 21.31])?.part).toBe(2); // Honolulu
  });

  it("leaves the lower 48 where they were, and the insets cover none of it", () => {
    // The same Lambert map as before the insets (common.js MAP box less its margins).
    const before = d3.geoConicConformal().parallels([33, 45]).rotate([96, 0]).fitExtent([[70, 370], [1010, 980]], SC.conus);
    for (const p of [[-122.33, 47.61], [-81.8, 24.55], [-66.98, 44.9], [-97.5, 25.9], [-95, 49]] as Pt[]) {
      expect(us.locate(p)?.part).toBe(0);
      expect(us(p)).toEqual(before(p));
    }
    // Every lower-48 vertex goes to the lower 48, never into an inset.
    const wrong: string[] = [];
    for (const f of SC.conus.features) for (const v of vertices(f)) if (us.locate(v)?.part !== 0) wrong.push(`${f.id} ${v}`);
    expect(wrong.slice(0, 5)).toEqual([]);
    // Nothing of the lower 48 lies under an inset's box (a grid of points through each; only states whose bounds hold the point are tested).
    const lower48 = us.parts[0]!.projection;
    const bounds = SC.conus.features.map((f) => ({ f, b: d3.geoBounds(f) }));
    const covered: string[] = [];
    for (const [[x0, y0], [x1, y1]] of [AK!.box!, HI!.box!]) {
      for (let i = 0; i <= 12; i++) {
        for (let j = 0; j <= 12; j++) {
          const ll = lower48.invert([x0 - 8 + ((x1 - x0 + 16) * i) / 12, y0 - 8 + ((y1 - y0 + 16) * j) / 12]);
          if (!ll) continue;
          const [lon, lat] = ll;
          const hit = bounds.find(({ f, b: [[w, s], [e, n]] }) => lon >= w && lon <= e && lat >= s && lat <= n && d3.geoContains(f, ll));
          if (hit) covered.push(`${hit.f.id} ${ll}`);
        }
      }
    }
    expect(covered).toEqual([]);
  });

  it("returns null off every part (Puerto Rico isn't drawn)", () => {
    expect(us([-66.1, 18.47])).toBeNull();
    expect(us.locate([-66.1, 18.47])).toBeNull();
  });
});
