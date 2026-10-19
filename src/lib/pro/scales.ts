/**
 * Colour scales for reading values back from tiles (lib/pro/sample.ts).
 *
 * NOAA's GeoServer renders MRMS and super-res NEXRAD tiles with fixed colour
 * ramps; these were sampled every 5 px from its own GetLegendGraphic images
 * (500 px ramps) and pinned to the values printed under them:
 *  - reflectivity (conus_bref_qcd, conus_cref_qcd, k***_sr_bref share one
 *    legend): linear, 5 px per dBZ, 0 dBZ at x = 137;
 *  - echo tops (conus_neet_v18): linear, 71.4 px per 10 kft, 10 kft at x = 89
 *    (one tick-mark pixel at x = 35 replaced by its neighbours' average);
 *  - super-res velocity (k***_sr_bvel): labels at uneven values, so
 *    piecewise-linear between them; the first 22 px are "RF" (range folded).
 * IEM's Level-III tiles use the classic NWS colour tables, which the radar
 * mode's legends (lib/radar/products.ts) approximate.
 */
import type { LegendStop } from "../radar/products";
import { FAMILIES, type ProductFamily } from "../radar/products";

export interface ValueScale {
  stops: LegendStop[];
  unit: string;
  decimals: number;
  /** Snap to the nearest stop instead of interpolating (class products). */
  categorical?: boolean;
  /** Colours of special values, e.g. range folding. */
  special?: { color: string; label: string }[];
}

/** Ramp colours at x = 0, 5, 10 … 495 of NOAA's 500 px legends. */
const REF_RAMP =
  "8d817f 8f8576 91886d 938b64 948e5b 979254 9c985e a29f68 a7a571 adac7b b3b384 b9ba8e bfc098 c6c7a2 ccceab d2d4b4 cbcdb4 c4c8b4 bdc1b4 b6bcb4 afb6b4 aab0b5 a4abb5 9fa6b5 99a0b5 939bb5 8993b2 808cb0 7684ad 6c7dab 6276a8 5c71a6 566ca4 4f67a3 4962a1 4460a0 496faa 4f7fb3 548fbd 599fc7 5eaece 5cb6c5 59bebc 57c7b3 54cfaa 51d69f 43d683 36d667 28d64a 1bd62e 0ed514 0ec513 0db512 0ca611 0c9610 0b880f 0b7f0e 0a770d 0a6e0b 0a660a 0e6109 3f7b07 709605 a2b004 d3ca02 ffe101 fad80a f7cf14 f2c51d eebc26 ebb32d efb324 f3b21b f7b212 fbb108 fd0101 eb0404 d80707 c50a0b b30d0e a21011 a60d0e a8090a ac0607 ae0303 fffdff f9e1fe f4c5fe eea9fd e88dfd e474fc ea75fd ef74fd f575fe fa75ff ab00fc 9a00f3 8900eb 7900e2 6800da";
const EET_RAMP =
  "818181 808585 7f8888 7e8c8c 7c8f8f 7c9293 7a9696 79999a 799d9e 79a2a3 79a6a7 79abac 79afb0 79b3b5 79b7b9 7abcbe 7bc0c2 7dc4c7 7ec8cb 7fcdcf 80d0d3 82d5d8 84d9dc 86dee1 88e2e6 8be7eb 8decef 90f1f4 92f5f9 11007f 13007f 15007f 160080 190080 1a0080 1c0081 1e0087 1f0098 2100a9 2300b9 2400c9 2600da 2700eb 488218 4c8a19 51931c 569b1d 5ba320 60ab21 65b424 6abc25 6fc528 74cd2a 79d52c 7ede2e 83e631 88ee33 8ad533 88882e 90902e 97972d 9e9f2d a5a62c adae2b b4b52a bdbe2c c6c72f d0d131 d9da34 e2e336 eced39 f5f63c 710809 78090a 800a0b 870c0d 8e0d0e 960e0f 9d1011 a41112 ac1213 b31314 bb1516 c31617 ca1718 d2191a c2c2c2 cacaca d2d2d2 dadada e2e2e2 eaeaea f2f2f2 a300bd a600c0 a900c4 ac00c7 af00cb b200ce b500d1";
const VEL_RAMP =
  "c8018b c8018b c8018b c8018b c8018b 790496 710597 690598 620598 570599 480499 390499 2a0399 1c039a 1d19a1 1d30a8 1d46af 1e5cb6 2177bf 2594c9 29b1d3 2ecedd 36e1e4 46e3e6 56e4e7 66e6e9 75e8eb 85e9ec 93eaed a2ecef b1eef1 a2f0d4 82f3a9 63f77d 43fa52 2bf931 21ed25 17e21a 0dd70f 04cc04 03bf03 03b303 02a702 029b02 028f02 038403 047903 056e03 0d670a 2c6b25 4b6e3f 6a725a 887674 8a7579 8a747b 8a747e 8a7280 876370 804952 7a2f35 731417 710000 7e0000 8b0000 970000 a40000 b20000 c00000 ce0000 dd0000 e60b10 ec1f2e f1334c f7476a fb5a85 fc6b96 fd7ba7 fe8cb8 ff9cc8 ffadc3 ffbcb8 ffccaf ffdca4 ffdf9b ffd591 ffcb87 ffc17d ffb774 feab6b fea062 fd9559 fd8a50 f5814b ed7a47 e57343 dd6c3f d4653a cb5d36 c25531 b94d2d";

/** Value printed under the legend at pixel x → value, piecewise linear (extrapolated past the ends). */
function anchored(anchors: readonly (readonly [number, number])[]) {
  return (x: number) => {
    let i = 0;
    while (i < anchors.length - 2 && x > anchors[i + 1]![0]) i++;
    const [x0, v0] = anchors[i]!;
    const [x1, v1] = anchors[i + 1]!;
    return v0 + ((x - x0) * (v1 - v0)) / (x1 - x0);
  };
}

function ramp(colors: string, valueAt: (x: number) => number, fromX = 0): LegendStop[] {
  return colors
    .split(" ")
    .map((c, i) => ({ x: i * 5, color: `#${c}` }))
    .filter((s) => s.x >= fromX)
    .map((s) => ({ value: Math.round(valueAt(s.x) * 100) / 100, color: s.color }));
}

export const NOAA_REFLECTIVITY: ValueScale = { stops: ramp(REF_RAMP, (x) => (x - 137) / 5), unit: "dBZ", decimals: 0 };

export const NOAA_ECHO_TOPS: ValueScale = { stops: ramp(EET_RAMP, (x) => 10 + ((x - 89) * 10) / 71.4), unit: "kft", decimals: 0 };

export const NOAA_VELOCITY: ValueScale = {
  stops: ramp(
    VEL_RAMP,
    anchored([
      [32, -100],
      [75.5, -80],
      [119, -60],
      [162, -45],
      [206, -20],
      [271.5, 0],
      [315, 20],
      [357.5, 45],
      [401.5, 60],
      [445.5, 80],
      [489, 100],
    ]),
    25,
  ),
  unit: "kt",
  decimals: 0,
  special: [{ color: "#c8018b", label: "RF" }],
};

const DECIMALS: Record<ProductFamily, number> = { reflectivity: 0, velocity: 0, srv: 0, cc: 2, zdr: 1, hc: 0 };

/** IEM Level-III colour scales (approximate: the radar mode's legends). */
export function familyScale(f: ProductFamily): ValueScale {
  return { stops: FAMILIES[f].legend, unit: FAMILIES[f].unit, decimals: DECIMALS[f], categorical: f === "hc" };
}

export const HC_CLASSES = ["Biological", "Ice crystals", "Dry snow", "Wet snow", "Rain", "Heavy rain", "Big drops", "Graupel", "Hail"] as const;

/** The scale that drew a frame, chosen by where its tiles come from. */
export function scaleForTiles(tileUrl: string, family: ProductFamily | null): ValueScale | null {
  if (tileUrl.includes("opengeo.ncep.noaa.gov")) {
    if (/_neet_/.test(tileUrl)) return NOAA_ECHO_TOPS;
    if (/_sr_bvel/.test(tileUrl)) return NOAA_VELOCITY;
    if (/_(bref|cref)_qcd|_sr_bref/.test(tileUrl)) return NOAA_REFLECTIVITY;
    return null;
  }
  if (tileUrl.includes("mesonet.agron.iastate.edu")) return family ? familyScale(family) : familyScale("reflectivity");
  return null;
}

// ── Scales for decoded NEXRAD data (exact values, our own colours) ──────────

/** NEXRAD Level III hydrometeor classes (value = code ÷ 10). */
export const L3_HC_CLASSES: Record<number, string> = {
  1: "Biological",
  2: "Ground clutter",
  3: "Ice crystals",
  4: "Dry snow",
  5: "Wet snow",
  6: "Rain",
  7: "Heavy rain",
  8: "Big drops",
  9: "Graupel",
  10: "Hail and rain",
  11: "Large hail",
  12: "Giant hail",
  14: "Unknown",
};

export type DecodedScaleId = "ref" | "vel" | "cc" | "zdr" | "kdp" | "hc" | "vil" | "eet";

export const DECODED_SCALES: Record<DecodedScaleId, ValueScale & { clearBelow?: boolean }> = {
  ref: { stops: FAMILIES.reflectivity.legend.filter((s, i, a) => i === 0 || s.value > a[i - 1]!.value), unit: "dBZ", decimals: 1, clearBelow: true },
  vel: { stops: FAMILIES.velocity.legend, unit: "kt", decimals: 0, special: [{ color: "#8a2be2", label: "RF" }] },
  cc: { stops: FAMILIES.cc.legend, unit: "ρhv", decimals: 3, special: [{ color: "#8a2be2", label: "RF" }] },
  zdr: { stops: FAMILIES.zdr.legend, unit: "dB", decimals: 2, special: [{ color: "#8a2be2", label: "RF" }] },
  kdp: {
    stops: [
      { value: -1, color: "#4b4b4b" },
      { value: 0, color: "#8c8c8c" },
      { value: 0.5, color: "#2d8ae6" },
      { value: 1, color: "#28c828" },
      { value: 2, color: "#ffe100" },
      { value: 3, color: "#ff8c00" },
      { value: 4, color: "#e60000" },
      { value: 6, color: "#ff5aaa" },
      { value: 8, color: "#ffffff" },
    ],
    unit: "°/km",
    decimals: 2,
  },
  hc: {
    stops: [
      { value: 1, color: "#9c9c9c" },
      { value: 2, color: "#5c5c5c" },
      { value: 3, color: "#e7a2a2" },
      { value: 4, color: "#7ec8ff" },
      { value: 5, color: "#2f58ff" },
      { value: 6, color: "#76d576" },
      { value: 7, color: "#058b05" },
      { value: 8, color: "#ffd700" },
      { value: 9, color: "#e88e00" },
      { value: 10, color: "#e0000f" },
      { value: 11, color: "#b0005a" },
      { value: 12, color: "#ff00ff" },
      { value: 14, color: "#c8c8c8" },
    ],
    unit: "class",
    decimals: 0,
    categorical: true,
  },
  vil: {
    stops: [
      { value: 1, color: "#8fb3d9" },
      { value: 5, color: "#2f7fd8" },
      { value: 10, color: "#1fb51f" },
      { value: 15, color: "#0e7d0e" },
      { value: 20, color: "#f2e600" },
      { value: 25, color: "#f2a900" },
      { value: 35, color: "#f25c00" },
      { value: 45, color: "#d60000" },
      { value: 55, color: "#a8006b" },
      { value: 65, color: "#e000e0" },
      { value: 75, color: "#ffffff" },
    ],
    unit: "kg/m²",
    decimals: 1,
    clearBelow: true,
  },
  eet: { ...NOAA_ECHO_TOPS, stops: NOAA_ECHO_TOPS.stops.filter((s) => s.value >= 0), clearBelow: true },
};

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Colour for a value on a scale: interpolated between stops (categorical
 * scales take the nearest stop), clamped at the top, and clamped or clear at
 * the bottom.
 */
export function scaleColor(scale: ValueScale & { clearBelow?: boolean }, v: number): [number, number, number] | null {
  const s = scale.stops;
  if (!s.length || !Number.isFinite(v)) return null;
  if (scale.categorical) {
    let best = s[0]!;
    for (const x of s) if (Math.abs(x.value - v) < Math.abs(best.value - v)) best = x;
    return Math.abs(best.value - v) < 0.5 ? hex(best.color) : null;
  }
  if (v < s[0]!.value) return scale.clearBelow ? null : hex(s[0]!.color);
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    if (v <= b.value) {
      const f = (v - a.value) / (b.value - a.value || 1);
      const ca = hex(a.color);
      const cb = hex(b.color);
      return [0, 1, 2].map((k) => Math.round(ca[k]! + f * (cb[k]! - ca[k]!))) as [number, number, number];
    }
  }
  return hex(s.at(-1)!.color);
}

/** Text for a decoded value (exact, no ≈). */
export function formatDecoded(scale: ValueScale, v: number, t: (s: string) => string = (s) => s): string {
  if (scale.categorical) return t(L3_HC_CLASSES[Math.round(v)] ?? "Unknown");
  return `${v.toFixed(scale.decimals)} ${scale.unit}`;
}
