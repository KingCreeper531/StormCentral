import { describe, expect, it } from "vitest";
import { destination, parseEventMotion, projectTrack, stormEta } from "./storm-motion";

describe("storm motion", () => {
  const text = "2024-05-21T21:47:00-00:00...storm...240DEG...30KT...4153 9178";

  it("parses the NWS eventMotionDescription", () => {
    const m = parseEventMotion(text)!;
    expect(m.headingDeg).toBe(60); // from 240° → toward 60° (ENE)
    expect(m.speedKt).toBe(30);
    expect(m.positions).toEqual([[-91.78, 41.53]]);
    expect(parseEventMotion("garbage")).toBeNull();
    expect(parseEventMotion(null)).toBeNull();
  });

  it("projects along the heading", () => {
    const m = parseEventMotion(text)!;
    const [p] = projectTrack({ ...m, time: new Date().toISOString() }, [60]);
    const pt = p!.points[0]!;
    expect(pt.lat).toBeGreaterThan(41.53);
    expect(pt.lon).toBeGreaterThan(-91.78);
  });

  it("computes ETA only for locations in the path", () => {
    const now = Date.parse("2024-05-21T21:47:00Z");
    const m = parseEventMotion(text)!;
    const ahead = destination({ lat: 41.53, lon: -91.78 }, 60, 55.56); // 30 kt ≈ 55.56 km/h → 60 min
    expect(stormEta(m, ahead, 15, now)).toBeCloseTo(60, 0);
    const behind = destination({ lat: 41.53, lon: -91.78 }, 240, 20);
    expect(stormEta(m, behind, 15, now)).toBeNull();
    const offside = destination(ahead, 150, 40);
    expect(stormEta(m, offside, 15, now)).toBeNull();
  });
});
