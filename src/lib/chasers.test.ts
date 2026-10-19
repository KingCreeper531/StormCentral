import { describe, expect, it } from "vitest";
import { DEFAULT_RADAR, normalizeRadar } from "@/store/app-store";
import { normalizeChaser } from "@/store/chaser-store";
import { motionOf, positionSchema, roundCoord, SEND_INTERVAL_MS, SEND_MIN_GAP_MS, shouldSend } from "./chasers";

const T0 = Date.UTC(2026, 4, 20, 21);
const HERE = { lat: 35.2226, lon: -97.4395 };
/** About 0.5 km north of HERE. */
const NORTH = { lat: 35.2271, lon: -97.4395 };
/** About 100 m north of HERE. */
const NEAR = { lat: 35.2235, lon: -97.4395 };

describe("shouldSend", () => {
  it("sends the first fix at once", () => {
    expect(shouldSend(null, HERE, T0)).toBe(true);
  });

  it("waits for the interval while standing still or creeping", () => {
    const last = { ...HERE, at: T0 };
    expect(shouldSend(last, NEAR, T0 + 30_000)).toBe(false);
    expect(shouldSend(last, NEAR, T0 + SEND_INTERVAL_MS)).toBe(true);
  });

  it("sends early after a real move, but never within the minimum gap", () => {
    const last = { ...HERE, at: T0 };
    expect(shouldSend(last, NORTH, T0 + SEND_MIN_GAP_MS - 1)).toBe(false);
    expect(shouldSend(last, NORTH, T0 + SEND_MIN_GAP_MS)).toBe(true);
  });
});

describe("motionOf", () => {
  it("uses the phone's heading and speed while driving", () => {
    expect(motionOf({ heading: 92.4, speed: 25 }, HERE, null, T0)).toEqual({ heading: 92, speedKmh: 90 });
  });

  it("drops a heading that's just noise at walking pace", () => {
    expect(motionOf({ heading: 200, speed: 0.5 }, HERE, null, T0)).toEqual({ heading: null, speedKmh: 2 });
  });

  it("works both out from the last fix when the phone gives neither", () => {
    const m = motionOf({ heading: null, speed: null }, NORTH, { ...HERE, at: T0 - 60_000 }, T0);
    expect(m.heading).toBe(0);
    expect(m.speedKmh).toBe(30);
    expect(motionOf({ heading: null, speed: null }, NEAR, { ...HERE, at: T0 - 60_000 }, T0).heading).toBe(0);
    // Under 100 m moved, a direction means nothing.
    expect(motionOf({ heading: null, speed: null }, { lat: 35.2229, lon: -97.4395 }, { ...HERE, at: T0 - 60_000 }, T0)).toEqual({ heading: null, speedKmh: null });
  });
});

describe("positionSchema", () => {
  const ok = { lat: 35.2, lon: -97.4, heading: 45, speedKmh: 80, accuracyM: 12, until: T0 + 3_600_000 };

  it("takes a position", () => {
    expect(positionSchema.safeParse(ok).success).toBe(true);
    expect(positionSchema.safeParse({ ...ok, heading: null, speedKmh: null, accuracyM: null }).success).toBe(true);
  });

  it("rejects nonsense", () => {
    for (const bad of [{ ...ok, lat: 91 }, { ...ok, lon: "x" }, { ...ok, heading: 400 }, { ...ok, speedKmh: -1 }, { ...ok, accuracyM: 50_000 }, { ...ok, until: 1.5 }, { lat: 1, lon: 1 }])
      expect(positionSchema.safeParse(bad).success).toBe(false);
  });

  it("rounds to about 10 m", () => {
    expect(roundCoord(35.123456789)).toBe(35.1235);
  });
});

describe("settings", () => {
  it("keeps the Chasers layer off unless it was turned on", () => {
    expect(DEFAULT_RADAR.showChasers).toBe(false);
    expect(normalizeRadar({ ...DEFAULT_RADAR, showChasers: undefined as unknown as boolean }).showChasers).toBe(false);
    expect(normalizeRadar({ ...DEFAULT_RADAR, showChasers: true }).showChasers).toBe(true);
  });

  it("restores sharing only inside its window", () => {
    expect(normalizeChaser({ sharing: true, hours: 4, until: T0 + 60_000, stream: "@mychase" }, T0)).toEqual({ sharing: true, hours: 4, until: T0 + 60_000, stream: "@mychase" });
    expect(normalizeChaser({ sharing: true, hours: 4, until: T0 - 1 }, T0)).toEqual({ sharing: false, hours: 4, until: null, stream: "" });
    expect(normalizeChaser({ sharing: true, hours: 4, until: null }, T0).sharing).toBe(false);
    expect(normalizeChaser({ hours: 7 as never }, T0).hours).toBe(4);
    expect(normalizeChaser(null, T0)).toEqual({ sharing: false, hours: 4, until: null, stream: "" });
  });
});
