/**
 * Colour tables for decoded radar (Professional mode's Level II and Level
 * III products): a few built-in alternatives to the standard scales and
 * GRLevelX palette files (.pal) people bring from GRLevel3, GR2Analyst and
 * the palette sites. The data stays exact; only the colours each value is
 * drawn in change (frame-sources recolours the decoded sweep's levels).
 *
 * The .pal format, line by line (case-insensitive; ";", "#" or "//" start a
 * comment):
 *   Product: BR | BV | CC | ZDR | KDP | VIL | ET …   which moment it's for
 *   Units: DBZ | KTS | MPH | MPS | KMH …                 the values' units
 *   Color:  value R G B [R G B]       a gradient from this value to the next,
 *                                     ending in the second colour if given
 *   Color4: value R G B A [R G B A]   the same with alpha
 *   SolidColor(4): value R G B [A]    one colour up to the next value
 *   RF: R G B                         range-folded gates
 * Values below the first entry are clear where the scale clears them
 * (reflectivity, VIL, echo tops) and take the first colour otherwise.
 * Fully transparent entries are clear too.
 */
import type { LegendStop } from "../radar/products";
import { DECODED_SCALES, type DecodedScaleId, type ValueScale } from "./scales";

export interface Palette {
  id: string;
  name: string;
  scale: DecodedScaleId;
  stops: LegendStop[];
  /** Range-folded gates. */
  rf?: string;
}

/** Scales a palette can be made for (hydrometeor classes are categories, not values). */
export const PALETTE_SCALES: readonly DecodedScaleId[] = ["ref", "vel", "cc", "zdr", "kdp", "vil", "eet"];

export const LIMITS = { imported: 24, entries: 256, name: 40 } as const;

// A jump between two colours at one value: the band below ends just short of it.
const EPS = 1e-3;

const PRODUCT: Record<string, DecodedScaleId> = {
  BR: "ref", BREF: "ref", REF: "ref", Z: "ref", DZ: "ref", DBZ: "ref", CR: "ref",
  BV: "vel", VEL: "vel", V: "vel", SRV: "vel", SRM: "vel", SW: "vel",
  CC: "cc", RHO: "cc", RHOHV: "cc",
  ZDR: "zdr", DR: "zdr",
  KDP: "kdp",
  VIL: "vil", DVL: "vil",
  ET: "eet", EET: "eet", TOPS: "eet",
};

/** Multipliers from a palette's speed units to knots (decoded velocity is in knots). */
const TO_KNOTS: Record<string, number> = { KTS: 1, KT: 1, KNOTS: 1, MPH: 0.868976, MPS: 1.943844, "M/S": 1.943844, MS: 1.943844, KMH: 0.539957, "KM/H": 0.539957, KPH: 0.539957 };

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("")}`;

interface Entry {
  value: number;
  color: string | null;
  /** Where the band ends: a second colour, the same one (solid), or the next entry's (undefined). */
  end?: string | null;
}

/** Errors are sentences for `t()`, with their placeholders in `params`. */
export type ParseResult = { ok: true; palette: Omit<Palette, "id"> } | { ok: false; error: string; params?: Record<string, string> };

/**
 * A GRLevelX palette as a colour table for one of our scales. `scale` is
 * used when the file doesn't say which product it's for.
 */
export function parsePal(text: string, name: string, scale?: DecodedScaleId): ParseResult {
  let product: DecodedScaleId | undefined;
  let unknownProduct: string | undefined;
  let units = "";
  let rf: string | undefined;
  const entries: Entry[] = [];
  for (const raw of text.slice(0, 200_000).split(/\r?\n/)) {
    const line = raw.replace(/(;|#|\/\/).*$/, "").trim();
    const m = line.match(/^([A-Za-z0-9]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const args = m[2]!.trim();
    const nums = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (key === "product") {
      const code = args.split(/\s+/)[0]!.toUpperCase();
      product = PRODUCT[code];
      if (!product) unknownProduct = code;
    } else if (key === "units") units = args.toUpperCase().replace(/\s+/g, "");
    else if (key === "rf") {
      if (nums.length >= 3 && nums.slice(0, 3).every((n) => Number.isFinite(n))) rf = hex(nums[0]!, nums[1]!, nums[2]!);
    } else if (key === "color" || key === "color4" || key === "solidcolor" || key === "solidcolor4") {
      const alpha = key.endsWith("4");
      const per = alpha ? 4 : 3;
      if (nums.length < 1 + per || nums.some((n) => !Number.isFinite(n))) continue;
      const [value, ...rest] = nums as [number, ...number[]];
      const color = (i: number) => (alpha && rest[i + 3]! < 1 ? null : hex(rest[i]!, rest[i + 1]!, rest[i + 2]!));
      const first = color(0);
      const end = key.startsWith("solid") ? first : rest.length >= 2 * per ? color(per) : undefined;
      entries.push({ value, color: first, end });
    }
    if (entries.length > LIMITS.entries) return { ok: false, error: "This palette has too many colours." };
  }
  const target = product ?? scale;
  if (!target) return unknownProduct ? { ok: false, error: "Palettes for {product} can't be used here.", params: { product: unknownProduct.slice(0, 12) } } : { ok: false, error: "The file doesn't say which product it's for." };
  if (!PALETTE_SCALES.includes(target)) return { ok: false, error: "Hydrometeor classes can't take a palette." };
  if (entries.length < 2) return { ok: false, error: "This isn't a GRLevelX palette (no Color lines)." };

  // Values in the scale's units.
  let k = 1;
  if (target === "vel") k = TO_KNOTS[units] ?? 1;
  if (target === "cc" && Math.max(...entries.map((e) => e.value)) > 2) k = 0.01; // percent
  const sorted = entries.map((e) => ({ ...e, value: e.value * k })).sort((a, b) => a.value - b.value);
  if (sorted.some((e) => Math.abs(e.value) > 10_000)) return { ok: false, error: "This palette's values are out of range." };

  const stops = stopsFrom(sorted);
  if (stops.length < 2) return { ok: false, error: "This palette has no visible colours." };
  return { ok: true, palette: { name: name.replace(/\.pal$/i, "").replace(/\p{Cc}/gu, " ").trim().slice(0, LIMITS.name) || "Palette", scale: target, stops, ...(rf ? { rf } : {}) } };
}

/**
 * Entries → legend stops for `scaleColor`, which interpolates between
 * neighbouring stops: each band starts at its value and ends just short of
 * the next. Clear bands (alpha 0) at the bottom are dropped (the scale
 * clears below its first stop); clear bands elsewhere can't be shown and
 * take their neighbours' colours.
 */
function stopsFrom(entries: readonly Entry[]): LegendStop[] {
  let i = 0;
  while (i < entries.length && entries[i]!.color === null) i++;
  const stops: LegendStop[] = [];
  for (; i < entries.length; i++) {
    const e = entries[i]!;
    const next = entries[i + 1];
    if (e.color === null) continue;
    if (stops.length && stops.at(-1)!.value >= e.value) stops.pop();
    stops.push({ value: e.value, color: e.color });
    if (!next) break;
    const end = e.end === undefined ? (next.color ?? e.color) : (e.end ?? e.color);
    if (next.value - EPS > e.value) stops.push({ value: round(next.value - EPS), color: end });
  }
  return stops;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

// ── Built-in alternatives ───────────────────────────────────────────────────

const solid = (pairs: readonly (readonly [number, string])[]): LegendStop[] =>
  pairs.flatMap(([value, color], i) => {
    const next = pairs[i + 1];
    return next ? [{ value, color }, { value: round(next[0] - EPS), color }] : [{ value, color }];
  });

/** Built-in tables besides each scale's standard one (id "standard"). */
export const BUILTIN_PALETTES: readonly Palette[] = [
  {
    id: "ref-nws",
    name: "Classic NWS (5 dBZ steps)",
    scale: "ref",
    stops: solid([
      [5, "#04e9e7"], [10, "#019ff4"], [15, "#0300f4"], [20, "#02fd02"], [25, "#01c501"], [30, "#008e00"], [35, "#fdf802"],
      [40, "#e5bc00"], [45, "#fd9500"], [50, "#fd0000"], [55, "#d40000"], [60, "#bc0000"], [65, "#f800fd"], [70, "#9854c6"], [75, "#fdfdfd"],
    ]),
  },
  {
    id: "ref-plasma",
    name: "Plasma (colour-blind safe)",
    scale: "ref",
    stops: [
      { value: 5, color: "#0d0887" }, { value: 20, color: "#6a00a8" }, { value: 30, color: "#b12a90" }, { value: 40, color: "#e16462" },
      { value: 50, color: "#fca636" }, { value: 60, color: "#f0f921" }, { value: 70, color: "#ffffff" },
    ],
  },
  {
    id: "vel-green-red",
    name: "Green–red",
    scale: "vel",
    stops: [
      { value: -100, color: "#7dffb8" }, { value: -60, color: "#00e000" }, { value: -30, color: "#009900" }, { value: -10, color: "#005c00" }, { value: -1, color: "#3a4a3a" },
      { value: 0, color: "#505050" }, { value: 1, color: "#4a3a3a" }, { value: 10, color: "#5c0000" }, { value: 30, color: "#990000" }, { value: 60, color: "#e00000" }, { value: 100, color: "#ff8fa8" },
    ],
  },
  {
    id: "vel-blue-orange",
    name: "Blue–orange (colour-blind safe)",
    scale: "vel",
    stops: [
      { value: -100, color: "#9be3ff" }, { value: -60, color: "#2b8cf0" }, { value: -30, color: "#1c5fbf" }, { value: -10, color: "#173d7a" },
      { value: 0, color: "#4a4a4a" }, { value: 10, color: "#7a3d17" }, { value: 30, color: "#bf5f1c" }, { value: 60, color: "#f08c2b" }, { value: 100, color: "#ffd27f" },
    ],
  },
];

/** The scale to draw with: the standard one, or its stops (and range-folded colour) from a palette. */
export function paletteScale(scaleId: DecodedScaleId, palette: Palette | null | undefined): ValueScale & { clearBelow?: boolean } {
  const base = DECODED_SCALES[scaleId];
  if (!palette || palette.scale !== scaleId) return base;
  const special = base.special && palette.rf ? [{ ...base.special[0]!, color: palette.rf }, ...base.special.slice(1)] : base.special;
  return { ...base, stops: palette.stops, special };
}

const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** Imported palettes from storage made safe: known scales, sorted finite stops, plain names. */
export function cleanPalettes(raw: unknown): Palette[] {
  if (!Array.isArray(raw)) return [];
  const out: Palette[] = [];
  for (const p of raw.slice(0, LIMITS.imported) as Partial<Palette>[]) {
    if (!p || typeof p !== "object" || !PALETTE_SCALES.includes(p.scale as DecodedScaleId) || !Array.isArray(p.stops)) continue;
    const stops = p.stops
      .filter((s): s is LegendStop => !!s && Number.isFinite(s.value) && isHex(s.color))
      .slice(0, LIMITS.entries * 2)
      .map((s) => ({ value: s.value, color: s.color.toLowerCase() }));
    if (stops.length < 2 || stops.some((s, i) => i > 0 && s.value < stops[i - 1]!.value)) continue;
    out.push({
      id: typeof p.id === "string" && /^[\w-]{1,40}$/.test(p.id) ? p.id : `pal-${Math.random().toString(36).slice(2, 10)}`,
      name: String(p.name ?? "Palette").replace(/\p{Cc}/gu, " ").trim().slice(0, LIMITS.name) || "Palette",
      scale: p.scale as DecodedScaleId,
      stops,
      ...(isHex(p.rf) ? { rf: p.rf.toLowerCase() } : {}),
    });
  }
  return out;
}
