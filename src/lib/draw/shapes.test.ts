import { describe, expect, it } from "vitest";
import { haversineKm } from "../geo";
import { circleRing, cleanShapes, screenBearing, shapesToGeoJSON, simplify, type Shape } from "./shapes";

describe("drawings", () => {
  it("draws circles through their edge point", () => {
    const ring = circleRing([-97.44, 35.22], [-97.34, 35.22], 32);
    expect(ring).toHaveLength(33);
    for (const [lon, lat] of ring) expect(haversineKm({ lat: 35.22, lon: -97.44 }, { lat, lon })).toBeCloseTo(haversineKm({ lat: 35.22, lon: -97.44 }, { lat: 35.22, lon: -97.34 }), 2);
  });

  it("points arrowheads the way they look on the map", () => {
    expect(screenBearing([-97, 35], [-97, 36])).toBeCloseTo(0, 5);
    expect(screenBearing([-97, 35], [-96, 35])).toBeCloseTo(90, 5);
    expect(screenBearing([-97, 35], [-98, 35])).toBeCloseTo(270, 5);
  });

  it("keeps a stroke's shape with fewer points", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i < 25 ? 0 : i - 25 }));
    const s = simplify(line, 0.5);
    expect(s.length).toBe(3);
    expect(s[1]).toEqual({ x: 25, y: 0 });
  });

  it("turns shapes into map features", () => {
    const shapes: Shape[] = [
      { id: "a", kind: "arrow", color: "#ff3b3b", width: 3, points: [[-97.5, 35], [-97.5, 35.5]] },
      { id: "t", kind: "text", color: "#ffffff", width: 3, points: [[-97, 35]], text: "Hook" },
      { id: "c", kind: "circle", color: "#ffd60a", width: 6, points: [[-97, 35], [-96.9, 35]] },
    ];
    const kinds = shapesToGeoJSON(shapes).features.map((f) => f.properties?.kind);
    expect(kinds).toEqual(["line", "head", "text", "line"]);
  });

  it("cleans whatever comes from outside", () => {
    const out = cleanShapes([
      { kind: "pen", color: "#ff3b3b", width: 3, points: [[-97, 35], [-96, 36], ["x", 1]] },
      { kind: "text", color: "javascript:alert(1)", width: 99, points: [[-97, 35]], text: "  a\u0007b  " },
      { kind: "line", points: [[-97, 35]] },
      { kind: "script", points: [[-97, 35], [-96, 35]] },
      { kind: "text", points: [[-97, 35]], text: "   " },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.points).toEqual([[-97, 35], [-96, 36]]);
    expect(out[1]).toMatchObject({ kind: "text", color: "#ff3b3b", width: 3, text: "a b" });
    expect(cleanShapes("nope")).toEqual([]);
  });
});
