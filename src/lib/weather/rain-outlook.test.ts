import { describe, expect, it } from "vitest";
import { intensityOf, precipKind, rainOutlook, roundMinutes } from "./rain-outlook";

const T0 = 1_800_000_000; // epoch s, a slot boundary
const NOW = T0 * 1000 + 60_000; // one minute into the first slot (which ends at T0 + 900)
const times = Array.from({ length: 12 }, (_, i) => T0 + (i + 1) * 900);

describe("rainOutlook", () => {
  it("is dry when every slot is under the threshold", () => {
    expect(rainOutlook(times, times.map(() => 0.05), NOW)).toMatchObject({ state: "dry", startsInMin: null });
  });

  it("times the start from the beginning of the first wet slot", () => {
    // Slots 0–2 dry, 3–5 wet (slot 3 covers T0+45 min … T0+60 min).
    const p = times.map((_, i) => (i >= 3 && i <= 5 ? [0.3, 1.2, 0.4][i - 3]! : 0));
    const o = rainOutlook(times, p, NOW)!;
    expect(o.state).toBe("starting");
    expect(o.startsInMin).toBe(44);
    expect(o.endsInMin).toBe(89);
    expect(o.intensity).toBe("moderate");
  });

  it("says when rain under way stops, or that it goes past the forecast", () => {
    const easing = times.map((_, i) => (i < 2 ? 2.5 : 0));
    expect(rainOutlook(times, easing, NOW)).toMatchObject({ state: "wet", endsInMin: 29, intensity: "heavy" });
    expect(rainOutlook(times, times.map(() => 0.2), NOW)).toMatchObject({ state: "wet", endsInMin: null });
  });

  it("returns null when the forecast is over", () => {
    expect(rainOutlook(times, times.map(() => 1), (T0 + 13 * 900) * 1000)).toBeNull();
  });
});

describe("helpers", () => {
  it("rounds and classifies", () => {
    expect(roundMinutes(3.4)).toBe(3);
    expect(roundMinutes(23)).toBe(25);
    expect(intensityOf(0.5)).toBe("light");
    expect(intensityOf(3)).toBe("heavy");
    expect(precipKind(-1)).toBe("snow");
    expect(precipKind(1.5)).toBe("mix");
    expect(precipKind(null)).toBe("rain");
  });
});
