import { describe, expect, it } from "vitest";
import { gateValues } from "./polar";
import { motionAlongBeam, stormRelative, towardOf } from "./srv";
import { gateAt, KT, polarSweep, rankine } from "./test-sweeps";

const DEG = Math.PI / 180;

describe("storm-relative velocity", () => {
  it("turns a FROM direction (NWS, storm cells) into the direction of travel", () => {
    expect(towardOf(239)).toBe(59);
    expect(towardOf(0)).toBe(180);
    expect(towardOf(350)).toBe(170);
    expect(towardOf(180)).toBe(0);
    expect(towardOf(-10)).toBe(170);
  });

  it("takes the motion along the beam: positive (away) where the storm heads", () => {
    // "239DEG...36KT": from the southwest, heading northeast.
    const m = { towardDeg: towardOf(239), speedKt: 36 };
    expect(motionAlongBeam(m, 59)).toBeCloseTo(36);
    expect(motionAlongBeam(m, 239)).toBeCloseTo(-36);
    expect(motionAlongBeam(m, 149)).toBeCloseTo(0);
  });

  it("removes a storm's own motion and keeps its couplet", () => {
    // A storm heading east at 40 kt with a cyclonic couplet in it, 50 km north-east of the radar.
    const motion = { towardDeg: 90, speedKt: 40 };
    const couplet = rankine(45.25, 50, 2, 20);
    const sweep = polarSweep((a, km) => (km < 120 ? 40 * Math.cos((a - 90) * DEG) + couplet(a, km) * KT : null), -120, 120, 0.97, { gates: 480 });
    const srv = stormRelative(sweep, motion);
    const v = gateValues(srv);
    // Far from the couplet only the motion was there: SRV ≈ 0 (within the level step).
    for (const az of [10.25, 90.25, 180.25, 270.25]) expect(Math.abs(v[gateAt(srv, az, 100)]!)).toBeLessThan(1);
    // East of the radar the storm moves away (+40 kt measured), west of it toward (−40).
    expect(gateValues(sweep)[gateAt(sweep, 90.25, 100)]).toBeCloseTo(40, 0);
    expect(gateValues(sweep)[gateAt(sweep, 270.25, 100)]).toBeCloseTo(-40, 0);
    // The couplet: ±20 m/s either side of its centre, balanced once the motion is gone.
    const right = v[gateAt(srv, 45.25 + 2 / 50 / DEG, 50)]!;
    const left = v[gateAt(srv, 45.25 - 2 / 50 / DEG, 50)]!;
    expect(right).toBeGreaterThan(30);
    expect(left).toBeLessThan(-30);
    expect(Math.abs(right + left)).toBeLessThan(2);
  });

  it("keeps range-folded and empty gates as they are", () => {
    const sweep = polarSweep((a, km) => (km < 50 ? 10 : null), -60, 60, 0.97, { radials: 360, gates: 300 });
    sweep.data[5] = 1;
    const srv = stormRelative(sweep, { towardDeg: 0, speedKt: 25 });
    expect(srv.data[5]).toBe(1);
    expect(srv.special).toEqual([{ level: 1, label: "RF" }]);
    expect(srv.data[299]).toBe(0);
  });
});
