import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { l2Time, l3Time, newest, parseKeys } from "./aws";
import { bunzip2 } from "./bzip2";
import { gunzipIfNeeded } from "./gzip";
import { parseLevel2 } from "./level2";
import { float16, parseLevel3 } from "./level3";
import { azimuthIndex, levelAt, maxRangeKm, polarOf, slantRange } from "./sweep";
import { sweepBox } from "./sweep-layer";

/**
 * Real files from the NOAA Open Data buckets (KTLX, 2026-10-19), with
 * expected values from MetPy's Level2File / Level3File.
 */
const FIX = join(__dirname, "__fixtures__");
const read = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));
interface L3Expected {
  code: number;
  elev: number;
  radials: number;
  /** radial, gate, raw level, MetPy value */
  samples: [number, number, number, number | null][];
}
interface L2Expected {
  cuts: number[];
  nRadials: number;
  nGates: number;
  /** radial, gate, MetPy value */
  samples: [number, number, number | null][];
}
const expected = JSON.parse(readFileSync(join(FIX, "expected.json"), "utf8")) as Record<string, unknown>;
const l3 = (name: string) => expected[name] as L3Expected;

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));

describe("bzip2", () => {
  it("decodes concatenated streams with long runs", () => {
    const out = bunzip2(read("two-streams.bz2"));
    expect(out.length).toBe(3186);
    expect(createHash("sha256").update(out).digest("hex")).toBe("c8ec853b06ab6cc31e5a068b1436ec7bad917ba22f5898e12bc6f613a00172fc");
  });

  it("rejects data that isn't bzip2", () => {
    expect(() => bunzip2(new TextEncoder().encode("hello"))).toThrow();
  });
});

describe("Level III", () => {
  for (const name of ["TLX_N0C_2026_10_19_15_52_10", "TLX_N0H_2026_10_19_15_58_54", "TLX_N1G_2026_10_19_15_52_10", "TLX_DVL_2026_10_19_15_52_10", "TLX_EET_2026_10_19_15_52_10"]) {
    it(`${name} matches MetPy`, () => {
      const e = l3(name);
      const p = parseLevel3(read(name));
      expect(p.code).toBe(e.code);
      expect(p.site).toBe("TLX");
      expect(p.nRadials).toBe(e.radials);
      expect(p.elevation).toBeCloseTo(e.elev, 1);
      expect(p.lat).toBeCloseTo(35.333, 3);
      expect(p.lon).toBeCloseTo(-97.278, 3);
      for (const [r, g, raw, val] of e.samples) {
        if (g >= p.nGates) continue;
        const lvl = p.data[r * p.nGates + g]!;
        expect(lvl).toBe(raw);
        const v = p.table[lvl]!;
        // Our velocities are in knots; MetPy's in m/s.
        const want = val == null ? NaN : e.code === 154 ? val * 1.943844 : val;
        if (Number.isNaN(want)) expect(Number.isNaN(v) || p.special.some((s) => s.level === lvl)).toBe(true);
        else expect(close(v, want)).toBe(true);
      }
    });
  }

  it("decodes NEXRAD's 16-bit floats", () => {
    expect(float16(0x3c00)).toBeCloseTo(0.5, 6); // exponent bias 16
    expect(float16(0x8000 | 0x3c00)).toBeCloseTo(-0.5, 6);
  });
});

describe("Level II", () => {
  const file = read("KTLX_cut1_V06");
  const e = expected.KTLX_cut1_V06 as L2Expected;

  it("reads the cut list from the VCP", () => {
    const r = parseLevel2(file, "REF", null);
    expect(r.site).toBe("KTLX");
    expect(r.cuts.map((c) => c.angle)).toEqual(e.cuts);
    expect(r.sweep).toBeNull();
  });

  it("decodes the lowest reflectivity cut like MetPy", () => {
    const s = parseLevel2(file, "REF", 0.5).sweep!;
    expect(s.nRadials).toBe(e.nRadials);
    expect(s.nGates).toBe(e.nGates);
    expect(s.firstGateKm).toBeCloseTo(2.125, 3);
    expect(s.gateKm).toBeCloseTo(0.25, 3);
    for (const [r, g, val] of e.samples) {
      const v = s.table[s.data[r * s.nGates + g]!]!;
      if (val == null) expect(Number.isNaN(v)).toBe(true);
      else expect(close(v, val)).toBe(true);
    }
  });

  it("returns no sweep for a tilt the volume doesn't have", () => {
    expect(parseLevel2(file, "REF", 19.5).sweep).toBeNull();
  });

  it("reads older archive files whose messages aren't bzip2-compressed", () => {
    // The same volume as the archive stored it before about 2016: header, then the messages as they are.
    const parts: Uint8Array[] = [file.subarray(0, 24)];
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    for (let pos = 24; pos + 4 <= file.length; ) {
      const size = Math.abs(dv.getInt32(pos));
      if (!size || pos + 4 + size > file.length) break;
      parts.push(bunzip2(file.subarray(pos + 4, pos + 4 + size), size * 8));
      pos += 4 + size;
    }
    const plain = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((o, p) => (plain.set(p, o), o + p.length), 0);
    const a = parseLevel2(file, "REF", 0.5).sweep!, b = parseLevel2(plain, "REF", 0.5).sweep!;
    expect(parseLevel2(plain, "REF", null).cuts).toEqual(parseLevel2(file, "REF", null).cuts);
    expect(b.nRadials).toBe(a.nRadials);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
});

describe("Level II before 2008 (Message 1)", () => {
  // KTLX, 10 May 2005: its first two cuts (0.5° reflectivity, then the 0.5° Doppler cut), gzipped as the archive stores it.
  const e = expected.KTLX20050510_000351_cut12 as Record<"REF" | "VEL", { radials: number; gates: number; first: number; width: number; samples: [number, number, number | null][] }>;
  const site = { lat: 35.3331, lon: -97.2778 };
  const KT = 1.943844;

  it("gunzips archive files and decodes both cuts like MetPy", async () => {
    const file = await gunzipIfNeeded(read("KTLX20050510_000351_cut12.gz"));
    for (const moment of ["REF", "VEL"] as const) {
      const r = parseLevel2(file, moment, 0.5, { site });
      const s = r.sweep!;
      const x = e[moment];
      expect(r.complete).toBe(true);
      expect(r.vcp).toBe(32);
      expect(r.cuts.map((c) => c.angle)).toEqual([0.48, 0.48]);
      expect([s.nRadials, s.nGates, s.firstGateKm, s.gateKm]).toEqual([x.radials, x.gates, x.first, x.width]);
      // No location in Message 1: it's the site's.
      expect([s.lat, s.lon]).toEqual([site.lat, site.lon]);
      for (const [r2, g, val] of x.samples) {
        const v = s.table[s.data[r2 * s.nGates + g]!]!;
        if (val == null) expect(Number.isNaN(v)).toBe(true);
        else expect(v).toBeCloseTo(moment === "VEL" ? val * KT : val, 4);
      }
    }
  });

  it("reads the oldest archive files (ARCHIVE2 header), even partial ones", async () => {
    const r = parseLevel2(await gunzipIfNeeded(read("KTLX19990503_230052.gz")), "REF", 0.5, { site });
    expect(r.time).toBe(Date.UTC(1999, 4, 3, 23, 0, 52));
    expect(r.sweep!.nRadials).toBe(68);
    expect(r.complete).toBe(false);
  });

  it("leaves files that aren't gzipped as they are", async () => {
    const b = new Uint8Array([65, 82, 50, 86]);
    expect(await gunzipIfNeeded(b)).toBe(b);
  });
});

describe("sweep geometry", () => {
  const s = parseLevel3(read("TLX_N0C_2026_10_19_15_52_10"));

  it("maps ground range to slant range with the 4/3-earth beam", () => {
    expect(slantRange(100, 0.5)).toBeGreaterThan(100);
    expect(slantRange(100, 0.5)).toBeLessThan(100.1);
    expect(slantRange(100, 19.5)).toBeGreaterThan(100 / Math.cos((19.5 * Math.PI) / 180) - 2);
  });

  it("finds the gate under a point", () => {
    const lut = azimuthIndex(s);
    // 50 km due east of the radar.
    const lon = s.lon + 50 / (111.195 * Math.cos((s.lat * Math.PI) / 180));
    const { km, az } = polarOf(s, s.lat, lon);
    expect(km).toBeCloseTo(50, 0);
    expect(az).toBeCloseTo(90, 0);
    const r = lut[900]!;
    const gate = Math.floor((slantRange(50, s.elevation) - s.firstGateKm) / s.gateKm + 0.5);
    expect(levelAt(s, s.lat, lon, lut)).toBe(s.data[r * s.nGates + gate]);
    expect(levelAt(s, s.lat + 10, s.lon, lut)).toBe(-1);
  });

  it("covers the sweep's reach with the GPU layer's quad", () => {
    const [x0, y0, x1, y1] = sweepBox(s);
    const x = (s.lon + 180) / 360;
    const y = (1 - Math.log(Math.tan(Math.PI / 4 + (s.lat * Math.PI) / 360)) / Math.PI) / 2;
    expect(x0).toBeLessThan(x);
    expect(x1).toBeGreaterThan(x);
    // Web Mercator y runs south: the north edge is the smaller one.
    expect(y0).toBeLessThan(y);
    expect(y1).toBeGreaterThan(y);
    // The sweep's whole range either way (the east–west width, in km at the radar's latitude).
    expect(((x1 - x0) * 40075.017 * Math.cos((s.lat * Math.PI) / 180)) / 2 / maxRangeKm(s)).toBeCloseTo(1, 2);
  });
});

describe("AWS keys", () => {
  it("parses listings and file times", () => {
    expect(parseKeys("<Key>TLX_N0C_2026_10_19_15_52_10</Key><Key>x</Key>")).toEqual(["TLX_N0C_2026_10_19_15_52_10", "x"]);
    expect(l3Time("TLX_N0C_2026_10_19_15_52_10")).toBe(Date.UTC(2026, 9, 19, 15, 52, 10));
    expect(l2Time("2026/10/19/KTLX/KTLX20261019_155210_V06")).toBe(Date.UTC(2026, 9, 19, 15, 52, 10));
    expect(Number.isNaN(l2Time("2026/10/18/KTLX/KTLX20261018_235710_V06_MDM"))).toBe(true);
    expect(l2Time("2013/05/20/KTLX/KTLX20130520_195111_V06.gz")).toBe(Date.UTC(2013, 4, 20, 19, 51, 11));
    expect(l2Time("1995/05/20/KTLX/KTLX19950520_000147.gz")).toBe(Date.UTC(1995, 4, 20, 0, 1, 47));
    const files = [1, 2, 3].map((t) => ({ key: String(t), url: "", time: t }));
    expect(newest(files, 2).map((f) => f.time)).toEqual([2, 3]);
  });
});
