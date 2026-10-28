import { describe, expect, it } from "vitest";
import { gateValues } from "./polar";
import { keepMax, MaxTrail, maxTrails } from "./trail";
import { gateAt, polarSweep } from "./test-sweeps";

describe("max value trails", () => {
  it("compares magnitudes but keeps the sign for signed products", () => {
    expect(keepMax(-30, 20, true)).toBe(-30);
    expect(keepMax(10, -25, true)).toBe(-25);
    expect(keepMax(-30, 20, false)).toBe(20);
    expect(keepMax(NaN, -5, true)).toBe(-5);
    expect(keepMax(7, NaN, false)).toBe(7);
  });

  it("leaves a track of a moving couplet, signs kept", () => {
    // Velocity (kt): an inbound/outbound pair moving 10 km north each volume, along the 90° radial.
    const volume = (k: number) =>
      polarSweep((a, km) => {
        const d = km - (30 + 10 * k);
        if (Math.abs(d) > 2) return 0;
        return a > 89.5 && a < 90 ? -40 - k : a >= 90 && a < 90.5 ? 30 + k : 0;
      }, -100, 100, 0.5, { gates: 300 });
    const out = maxTrails("KTLX|vol-vel|0.5", [0, 1, 2].map(volume), true);
    const v = gateValues(out[2]!);
    // Every position the couplet passed keeps its extreme, inbound negative and outbound positive.
    for (const k of [0, 1, 2]) {
      expect(v[gateAt(out[2]!, 89.75, 30 + 10 * k)]).toBeCloseTo(-40 - k, 1);
      expect(v[gateAt(out[2]!, 90.25, 30 + 10 * k)]).toBeCloseTo(30 + k, 1);
    }
    // The first volume's trail is only itself.
    expect(gateValues(out[0]!)[gateAt(out[0]!, 89.75, 40)]).toBe(0);
  });

  it("takes the plain maximum for unsigned products, on the first volume's gates", () => {
    const a = polarSweep((az) => (az < 180 ? 50 : 10), -30, 90, 0.5, { gates: 50 });
    // The next scan's radials start a quarter-degree later.
    const b = polarSweep((az) => (az < 180 ? 20 : 60), -30, 90, 0.5, { gates: 50, start: 0.25 });
    const [, t] = maxTrails("KTLX|vol-ref|0.5", [a, b], false);
    const v = gateValues(t!);
    expect(t!.azStart[0]).toBe(0);
    expect(v[gateAt(t!, 90.25, 10)]).toBe(50);
    expect(v[gateAt(t!, 270.25, 10)]).toBe(60);
  });

  it("starts over when the site, product or tilt changes", () => {
    const trail = new MaxTrail(false);
    const hot = polarSweep(() => 60, -30, 90, 0.5, { radials: 360, gates: 20 });
    const cool = polarSweep(() => 20, -30, 90, 0.5, { radials: 360, gates: 20 });
    trail.add("KTLX|vol-ref|0.5", hot);
    expect(gateValues(trail.add("KTLX|vol-ref|0.5", cool))[5]).toBe(60);
    expect(gateValues(trail.add("KINX|vol-ref|0.5", cool))[5]).toBe(20);
    expect(gateValues(trail.add("KINX|vol-zdr|0.5", cool))[5]).toBe(20);
    trail.reset();
    expect(trail.size).toBe(0);
  });
});
