import { describe, expect, it } from "vitest";
import { sweepColors } from "./nexrad/sweep";
import { BUILTIN_PALETTES, cleanPalettes, paletteScale, parsePal } from "./palettes";
import { DECODED_SCALES, scaleColor } from "./scales";

const BR = `; A reflectivity palette in GRLevelX's format
Product: BR
Units: DBZ
Step: 5

Color: 10 164 164 255 100 100 192
Color: 20 64 128 255 32 64 128   // gradient to its own end colour
SolidColor: 30 0 255 0
Color: 40 255 255 0
Color: 50 255 0 0
`;

const parsed = (text: string, name = "test.pal", scale?: Parameters<typeof parsePal>[2]) => {
  const r = parsePal(text, name, scale);
  if (!r.ok) throw new Error(r.error);
  return r.palette;
};
const color = (p: ReturnType<typeof parsed>, v: number) => scaleColor(paletteScale(p.scale, { ...p, id: "x" }), v);

describe("parsePal", () => {
  it("reads gradients, second colours and solid bands", () => {
    const p = parsed(BR, "Fancy BR.pal");
    expect(p.name).toBe("Fancy BR");
    expect(p.scale).toBe("ref");
    expect(color(p, 10)).toEqual([164, 164, 255]);
    // The band from 10 ends in its own second colour, just short of 20.
    expect(color(p, 19.99)).toEqual([100, 100, 192]);
    expect(color(p, 20)).toEqual([64, 128, 255]);
    // Solid: the same colour all the way to 40.
    expect(color(p, 30)).toEqual([0, 255, 0]);
    expect(color(p, 39.99)).toEqual([0, 255, 0]);
    // No second colour: a gradient to the next entry's colour.
    expect(color(p, 45)).toEqual([255, 127, 0]);
    // Above the last entry: its colour. Below the first: clear (reflectivity clears).
    expect(color(p, 70)).toEqual([255, 0, 0]);
    expect(color(p, 5)).toBeNull();
  });

  it("converts velocity to knots and keeps the range-folded colour", () => {
    const p = parsed("Product: BV\nUnits: MPH\nRF: 119 0 125\nColor: -100 0 255 0\nColor: 0 128 128 128\nColor: 100 255 0 0\n");
    expect(p.scale).toBe("vel");
    expect(p.rf).toBe("#77007d");
    expect(p.stops[0]!.value).toBeCloseTo(-86.9, 1);
    expect(p.stops.at(-1)!.value).toBeCloseTo(86.9, 1);
    expect(paletteScale("vel", { ...p, id: "x" }).special?.[0]?.color).toBe("#77007d");
  });

  it("reads Color4, dropping fully transparent bands at the bottom", () => {
    const p = parsed("Product: CC\nColor4: 0.2 0 0 0 0\nColor4: 0.5 90 90 90 255\nColor4: 1.0 255 255 255 255\n");
    expect(p.stops[0]).toEqual({ value: 0.5, color: "#5a5a5a" });
  });

  it("takes percent correlation coefficients", () => {
    const p = parsed("Product: CC\nColor: 20 0 0 255\nColor: 100 255 255 255\n");
    expect(p.stops[0]!.value).toBeCloseTo(0.2);
    expect(p.stops.at(-1)!.value).toBeCloseTo(1);
  });

  it("uses the panel's product when the file doesn't name one, and refuses what it can't use", () => {
    expect(parsed("Color: 0 0 0 255\nColor: 10 255 0 0\n", "x.pal", "zdr").scale).toBe("zdr");
    expect(parsePal("Color: 0 0 0 255\nColor: 10 255 0 0\n", "x.pal")).toEqual({ ok: false, error: "The file doesn't say which product it's for." });
    expect(parsePal("Product: NROT\nColor: 0 0 0 255\nColor: 1 255 0 0\n", "x.pal")).toMatchObject({ ok: false, params: { product: "NROT" } });
    expect(parsePal("hello world", "x.pal", "ref")).toMatchObject({ ok: false });
    expect(parsePal(`Product: BR\n${"Color: 1 0 0 0\n".repeat(300)}`, "x.pal")).toMatchObject({ ok: false });
  });

  it("keeps names plain and short", () => {
    expect(parsed(BR, "a\u0007b".padEnd(80, "c") + ".pal").name).toMatch(/^a bc+$/);
    expect(parsed(BR, "a\u0007b".padEnd(80, "c") + ".pal").name.length).toBeLessThanOrEqual(40);
  });
});

describe("built-in palettes", () => {
  it("are ordered, finite and on scales that take palettes", () => {
    for (const p of BUILTIN_PALETTES) {
      expect(p.stops.length).toBeGreaterThan(1);
      for (let i = 1; i < p.stops.length; i++) expect(p.stops[i]!.value).toBeGreaterThan(p.stops[i - 1]!.value);
      expect(cleanPalettes([p])).toEqual([p]);
    }
  });

  it("classic NWS reflectivity is solid 5 dBZ bands", () => {
    const nws = BUILTIN_PALETTES.find((p) => p.id === "ref-nws")!;
    expect(color({ ...nws }, 42)).toEqual([229, 188, 0]);
    expect(color({ ...nws }, 44.99)).toEqual([229, 188, 0]);
    expect(color({ ...nws }, 45)).toEqual([253, 149, 0]);
  });
});

describe("cleanPalettes", () => {
  it("drops bad entries and odd fields", () => {
    const good = { id: "pal-1", name: "Mine", scale: "ref", stops: [{ value: 0, color: "#000000" }, { value: 10, color: "#FFFFFF" }] };
    const out = cleanPalettes([good, { ...good, scale: "hc" }, { ...good, stops: [{ value: 5, color: "#000000" }, { value: 1, color: "#000000" }] }, { ...good, stops: [{ value: 0, color: "red" }] }, null, "x"]);
    expect(out).toEqual([{ ...good, stops: [{ value: 0, color: "#000000" }, { value: 10, color: "#ffffff" }] }]);
    expect(cleanPalettes("nope")).toEqual([]);
  });
});

describe("paletteScale and sweepColors", () => {
  it("keeps the standard scale without a palette, or with one for another scale", () => {
    expect(paletteScale("ref", null)).toBe(DECODED_SCALES.ref);
    expect(paletteScale("ref", BUILTIN_PALETTES.find((p) => p.scale === "vel"))).toBe(DECODED_SCALES.ref);
  });

  it("colours each raw level, range folding in the flag colour", () => {
    const sweep = { table: new Float32Array([NaN, 0, 50, 70]), special: [{ level: 0, label: "RF" }] };
    const p = { ...parsed("Product: BV\nUnits: KTS\nRF: 255 0 255\nColor: -64 0 255 0\nColor: 64 255 0 0\n"), id: "x" };
    const c = sweepColors(sweep, paletteScale("vel", p));
    expect([...c.slice(0, 4)]).toEqual([255, 0, 255, 255]);
    expect([...c.slice(12, 16)]).toEqual([255, 0, 0, 255]);
  });
});
