/**
 * How the lower third and the warnings ticker look (broadcast settings):
 * their colours, size, shape, wording and the ticker's speed. Shared by the
 * on-screen graphics (components/broadcast) and exported frames (canvas.ts),
 * so a clip looks like the screen it came from.
 */

export type LowerSize = "s" | "m" | "l";
export type TickerSpeed = "slow" | "normal" | "fast";

export interface BroadcastLook {
  /** The lower third's title when no warning or scene is picked; empty = the place's name. */
  lowerTitle: string;
  /** Its second line then; empty = the radar product. */
  lowerSubtitle: string;
  /** The bar down its left edge (a warning keeps its own colour); null = the accent colour. */
  lowerColor: string | null;
  lowerBg: string;
  /** The panel's opacity, 0.4 to 1. */
  lowerOpacity: number;
  lowerText: string;
  lowerSize: LowerSize;
  lowerSquare: boolean;
  /** Narrower, on the left, instead of the full width. */
  lowerCompact: boolean;
  /** The ticker's label; empty = "WARNINGS" in the app's language. */
  tickerLabel: string;
  /** The label's colour; null = the accent colour. */
  tickerLabelColor: string | null;
  tickerBg: string;
  tickerText: string;
  tickerSpeed: TickerSpeed;
  tickerLarge: boolean;
  /** The TOR / SVR / FFW chips before each warning. */
  tickerCodes: boolean;
  /** A message of your own that runs at the front of the ticker (a website, "Stay safe"). */
  tickerMessage: string;
}

export const DEFAULT_LOOK: BroadcastLook = {
  lowerTitle: "",
  lowerSubtitle: "",
  lowerColor: null,
  lowerBg: "#0e1424",
  lowerOpacity: 0.86,
  lowerText: "#f4f6fb",
  lowerSize: "m",
  lowerSquare: false,
  lowerCompact: false,
  tickerLabel: "",
  tickerLabelColor: null,
  tickerBg: "#050810",
  tickerText: "#e8ecf4",
  tickerSpeed: "normal",
  tickerLarge: false,
  tickerCodes: true,
  tickerMessage: "",
};

export const LOWER_SIZES: readonly LowerSize[] = ["s", "m", "l"];
export const TICKER_SPEEDS: readonly TickerSpeed[] = ["slow", "normal", "fast"];

const HEX = /^#[0-9a-f]{6}$/i;
const text = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.replace(/\s+/g, " ").trimStart().slice(0, max) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
const colorOrNull = (v: unknown, fallback: string | null) => (v === null ? null : typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** A look from anything (saved state, synced settings, a partial change), every field checked. */
export function cleanLook(raw: unknown, base: BroadcastLook = DEFAULT_LOOK): BroadcastLook {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof BroadcastLook, unknown>>;
  return {
    lowerTitle: text(p.lowerTitle, 60, base.lowerTitle),
    lowerSubtitle: text(p.lowerSubtitle, 80, base.lowerSubtitle),
    lowerColor: colorOrNull(p.lowerColor, base.lowerColor),
    lowerBg: color(p.lowerBg, base.lowerBg),
    lowerOpacity: typeof p.lowerOpacity === "number" && Number.isFinite(p.lowerOpacity) ? Math.min(1, Math.max(0.4, p.lowerOpacity)) : base.lowerOpacity,
    lowerText: color(p.lowerText, base.lowerText),
    lowerSize: LOWER_SIZES.includes(p.lowerSize as LowerSize) ? (p.lowerSize as LowerSize) : base.lowerSize,
    lowerSquare: bool(p.lowerSquare, base.lowerSquare),
    lowerCompact: bool(p.lowerCompact, base.lowerCompact),
    tickerLabel: text(p.tickerLabel, 24, base.tickerLabel),
    tickerLabelColor: colorOrNull(p.tickerLabelColor, base.tickerLabelColor),
    tickerBg: color(p.tickerBg, base.tickerBg),
    tickerText: color(p.tickerText, base.tickerText),
    tickerSpeed: TICKER_SPEEDS.includes(p.tickerSpeed as TickerSpeed) ? (p.tickerSpeed as TickerSpeed) : base.tickerSpeed,
    tickerLarge: bool(p.tickerLarge, base.tickerLarge),
    tickerCodes: bool(p.tickerCodes, base.tickerCodes),
    tickerMessage: text(p.tickerMessage, 140, base.tickerMessage),
  };
}

/** The lower third's scale for its size. */
export const lowerScale = (size: LowerSize) => ({ s: 0.82, m: 1, l: 1.22 })[size];

/** Seconds for one run of the ticker, from how much it says and the speed picked. */
export function tickerSeconds(chars: number, speed: TickerSpeed): number {
  const base = Math.max(30, Math.round(chars / 9));
  return Math.round(base * { slow: 1.6, normal: 1, fast: 0.6 }[speed]);
}

/** "#0e1424" at `alpha` as rgba(). */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Whether a look differs from the default in a lower-third or ticker field. */
export const isDefault = (look: BroadcastLook, keys: readonly (keyof BroadcastLook)[]) => keys.every((k) => look[k] === DEFAULT_LOOK[k]);

export const LOWER_KEYS = ["lowerTitle", "lowerSubtitle", "lowerColor", "lowerBg", "lowerOpacity", "lowerText", "lowerSize", "lowerSquare", "lowerCompact"] as const satisfies readonly (keyof BroadcastLook)[];
export const TICKER_KEYS = ["tickerLabel", "tickerLabelColor", "tickerBg", "tickerText", "tickerSpeed", "tickerLarge", "tickerCodes", "tickerMessage"] as const satisfies readonly (keyof BroadcastLook)[];
