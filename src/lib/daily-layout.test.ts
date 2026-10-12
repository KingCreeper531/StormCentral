import { describe, expect, it } from "vitest";
import { canMoveDailyItem, dailySections, defaultDailyLayout, moveDailyItem, normalizeDailyLayout, type DailyItem } from "./daily-layout";

describe("daily layout", () => {
  it("defaults to every panel, visible, in the standard order", () => {
    const d = defaultDailyLayout();
    expect(d[0]).toEqual({ id: "hero", col: "main", hidden: false });
    expect(d.every((x) => !x.hidden)).toBe(true);
    expect(new Set(d.map((x) => x.id)).size).toBe(d.length);
  });

  it("cleans saved layouts and slots in panels added later", () => {
    const saved = [
      { id: "radar", col: "full", hidden: false },
      { id: "hero", col: "bogus", hidden: true },
      { id: "radar", col: "side" }, // repeat
      { id: "nope", col: "main" },
    ];
    const n = normalizeDailyLayout(saved);
    expect(n[0]).toEqual({ id: "radar", col: "full", hidden: false });
    expect(n.find((x) => x.id === "hero")).toEqual({ id: "hero", col: "main", hidden: true });
    expect(n).toHaveLength(defaultDailyLayout().length);
    // Missing panels follow their default predecessor: "severe" after "radar", "nowcast" after "hero".
    expect(n[1]!.id).toBe("severe");
    const hero = n.findIndex((x) => x.id === "hero");
    expect(n[hero + 1]!.id).toBe("nowcast");
    expect(normalizeDailyLayout("junk")).toEqual(defaultDailyLayout());
  });

  it("moves among visible panels, skipping hidden ones", () => {
    const l: DailyItem[] = [
      { id: "hero", col: "main", hidden: false },
      { id: "nowcast", col: "side", hidden: true },
      { id: "hourly", col: "main", hidden: false },
    ];
    expect(moveDailyItem(l, "hourly", -1).map((x) => x.id)).toEqual(["hourly", "nowcast", "hero"]);
    expect(moveDailyItem(l, "hero", -1)).toBe(l);
    expect(moveDailyItem(l, "hourly", 1)).toBe(l);
  });

  it("on wide screens moves within the column, or past full-width panels", () => {
    const l: DailyItem[] = [
      { id: "hero", col: "main", hidden: false },
      { id: "nowcast", col: "side", hidden: false },
      { id: "hourly", col: "main", hidden: false },
      { id: "severe", col: "full", hidden: false },
      { id: "radar", col: "side", hidden: false },
    ];
    // Hourly swaps with Hero (same column), not Next 3 hours.
    expect(moveDailyItem(l, "hourly", -1, true).map((x) => x.id)).toEqual(["hourly", "nowcast", "hero", "severe", "radar"]);
    // Radar steps up past the full-width outlook.
    expect(moveDailyItem(l, "radar", -1, true).map((x) => x.id)).toEqual(["hero", "nowcast", "hourly", "radar", "severe"]);
    expect(canMoveDailyItem(l, "nowcast", -1, true)).toBe(false);
    expect(canMoveDailyItem(l, "nowcast", -1, false)).toBe(true);
  });

  it("groups columns into sections split by full-width panels", () => {
    const s = dailySections([
      { id: "hero", col: "main", hidden: false },
      { id: "nowcast", col: "side", hidden: false },
      { id: "severe", col: "full", hidden: false },
      { id: "hourly", col: "main", hidden: false },
    ]);
    expect(s.map((x) => x.kind)).toEqual(["split", "full", "split"]);
    expect(s[0]).toMatchObject({ main: [{ id: "hero" }], side: [{ id: "nowcast" }] });
  });
});
