import { describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, cleanName, cleanPresets, decodeStyle, encodeStyle, LIMITS, matchingPreset } from "./presets";
import { DEFAULT_MAP_STYLE, normalizeMapStyle, type MapStyle } from "./style";

const style = (patch: Partial<MapStyle>) => normalizeMapStyle({ ...DEFAULT_MAP_STYLE, ...patch });

describe("share codes", () => {
  const mine = style({ basemap: "streets", hillshade: 0.6, states: { show: true, color: "#facc15", width: 2 }, roads: "major" });

  it("round-trip a style and its name", () => {
    expect(decodeStyle(encodeStyle("Storm day", mine))).toEqual({ name: "Storm day", style: mine });
  });

  it("are URL-safe and only carry what differs from the default", () => {
    const code = encodeStyle("Storm day", mine);
    expect(code).toMatch(/^[\w-]+$/);
    expect(encodeStyle("", DEFAULT_MAP_STYLE).length).toBeLessThan(40);
    expect(decodeStyle(encodeStyle("", DEFAULT_MAP_STYLE))).toEqual({ name: "Shared style", style: DEFAULT_MAP_STYLE });
  });

  it("are found inside a whole link", () => {
    const code = encodeStyle("Chase", mine);
    expect(decodeStyle(`https://app.stormcentralwx.com/?mode=severe&mapstyle=${code}`)?.style).toEqual(mine);
    expect(decodeStyle(`  ${code}\n`)?.name).toBe("Chase");
  });

  it("keep non-ASCII names", () => {
    expect(decodeStyle(encodeStyle("Tormenta día 🌪", mine))?.name).toBe("Tormenta día 🌪");
  });

  it("refuse anything else, and clean what they carry", () => {
    for (const bad of ["", "not a code!", "abc", "x".repeat(LIMITS.code + 1), btoa(JSON.stringify({ v: 2, s: {} })), btoa("[1,2]")]) expect(decodeStyle(bad)).toBeNull();
    const evil = btoa(JSON.stringify({ v: 1, n: "a\u0000b".repeat(30), s: { basemap: "evil", water: "url(x)", hillshade: 9 } })).replace(/=+$/, "");
    const got = decodeStyle(evil)!;
    expect(got.name.length).toBeLessThanOrEqual(LIMITS.name);
    expect(got.name).not.toMatch(/\p{Cc}/u);
    expect(got.style).toEqual(style({ hillshade: 1 }));
  });
});

describe("presets", () => {
  it("built-ins are normalized, distinct, and Standard is the default", () => {
    expect(BUILTIN_PRESETS[0]!.style).toEqual(DEFAULT_MAP_STYLE);
    const seen = new Set(BUILTIN_PRESETS.map((p) => JSON.stringify(p.style)));
    expect(seen.size).toBe(BUILTIN_PRESETS.length);
    for (const p of BUILTIN_PRESETS) expect(normalizeMapStyle(p.style)).toEqual(p.style);
  });

  it("know which preset a style is", () => {
    const chaser = BUILTIN_PRESETS.find((p) => p.id === "chaser")!;
    expect(matchingPreset(chaser.style, BUILTIN_PRESETS)?.id).toBe("chaser");
    expect(matchingPreset(DEFAULT_MAP_STYLE, BUILTIN_PRESETS)?.id).toBe("standard");
    expect(matchingPreset(style({ labelSize: 1.5 }), BUILTIN_PRESETS)).toBeUndefined();
  });

  it("clean saved presets from storage", () => {
    const ok = { id: "mp-1", name: "  Mine  ", style: style({ roads: "off" }) };
    const out = cleanPresets([ok, { name: "", style: {} }, null, { id: "bad id!", name: "Other", style: { basemap: "nope" } }, ...Array(30).fill(ok)]);
    expect(out[0]).toEqual({ ...ok, name: "Mine" });
    expect(out[1]!.name).toBe("Other");
    expect(out[1]!.id).toMatch(/^mp-/);
    expect(out[1]!.style).toEqual(DEFAULT_MAP_STYLE);
    expect(out.length).toBeLessThanOrEqual(LIMITS.saved);
    expect(cleanPresets("x")).toEqual([]);
  });

  it("clean names", () => {
    expect(cleanName(" a\n\tb ")).toBe("a b");
    expect(cleanName("x".repeat(99))).toHaveLength(LIMITS.name);
    expect(cleanName(undefined)).toBe("");
  });
});
