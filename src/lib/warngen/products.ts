/**
 * Spotter WarnGen: the products a spotter can issue to the StormCentral
 * spotter network from Professional mode, modelled on the NWS's WarnGen
 * (AWIPS II) templates. These are never NWS products: everything that shows
 * them labels them as unofficial spotter-network warnings.
 */

export const WARN_KINDS = ["TOR", "SVR", "FFW", "SQW", "SPS"] as const;
export type WarnKind = (typeof WARN_KINDS)[number];

export const WARN_BASES = ["radar", "spotter", "observed"] as const;
export type WarnBasis = (typeof WARN_BASES)[number];

export const WARN_THREATS = ["base", "considerable", "destructive", "catastrophic"] as const;
export type WarnThreat = (typeof WARN_THREATS)[number];

export interface WarnProduct {
  /** "Tornado Warning". Shown as "Spotter Tornado Warning". */
  label: string;
  /** The NWS hazard colour for the same product. */
  color: string;
  /** Durations offered (minutes); the first stationary-friendly product allows hours. */
  minutes: readonly number[];
  defaultMinutes: number;
  /** Damage-threat tiers this product can carry (always starts with "base"). */
  threats: readonly WarnThreat[];
  /** Which tags the editor offers. */
  hail: boolean;
  wind: boolean;
  /** "Tornado possible" tag (severe thunderstorm warnings). */
  tornadoPossible: boolean;
  /** A slow or stationary storm is normal (flooding): no track needed. */
  stationary: boolean;
}

export const WARN_PRODUCTS: Record<WarnKind, WarnProduct> = {
  TOR: {
    label: "Tornado Warning",
    color: "#ff0000",
    minutes: [15, 20, 30, 45, 60],
    defaultMinutes: 30,
    threats: ["base", "considerable", "catastrophic"],
    hail: true,
    wind: false,
    tornadoPossible: false,
    stationary: false,
  },
  SVR: {
    label: "Severe Thunderstorm Warning",
    color: "#ffa500",
    minutes: [15, 30, 45, 60, 90],
    defaultMinutes: 45,
    threats: ["base", "considerable", "destructive"],
    hail: true,
    wind: true,
    tornadoPossible: true,
    stationary: false,
  },
  FFW: {
    label: "Flash Flood Warning",
    color: "#8b0000",
    minutes: [60, 90, 120, 180, 240, 360],
    defaultMinutes: 180,
    threats: ["base", "considerable", "catastrophic"],
    hail: false,
    wind: false,
    tornadoPossible: false,
    stationary: true,
  },
  SQW: {
    label: "Snow Squall Warning",
    color: "#c71585",
    minutes: [15, 30, 45, 60],
    defaultMinutes: 30,
    threats: ["base"],
    hail: false,
    wind: true,
    tornadoPossible: false,
    stationary: false,
  },
  SPS: {
    label: "Significant Weather Advisory",
    color: "#ffe4b5",
    minutes: [15, 30, 45, 60],
    defaultMinutes: 30,
    threats: ["base"],
    hail: true,
    wind: true,
    tornadoPossible: false,
    stationary: false,
  },
};

export const isWarnKind = (v: unknown): v is WarnKind => typeof v === "string" && (WARN_KINDS as readonly string[]).includes(v);

/** Hail sizes (inches) and the NWS names for them. */
export const HAIL_SIZES: readonly { inches: number; name: string }[] = [
  { inches: 0.5, name: "half inch" },
  { inches: 0.75, name: "penny size" },
  { inches: 1, name: "quarter size" },
  { inches: 1.25, name: "half dollar size" },
  { inches: 1.5, name: "ping pong ball size" },
  { inches: 1.75, name: "golf ball size" },
  { inches: 2, name: "hen egg size" },
  { inches: 2.5, name: "tennis ball size" },
  { inches: 2.75, name: "baseball size" },
  { inches: 3, name: "tea cup size" },
  { inches: 4, name: "softball size" },
  { inches: 4.5, name: "grapefruit size" },
];

export const WIND_GUSTS_MPH = [40, 50, 60, 70, 80, 90, 100] as const;

export const hailName = (inches: number) => HAIL_SIZES.find((h) => h.inches === inches)?.name ?? `${inches.toFixed(2)} inch`;

/** Severe criteria: 1 inch hail or 58 mph wind. */
export const SEVERE_HAIL = 1;
export const SEVERE_WIND = 58;


/** Limits that keep a polygon a storm-scale warning. */
export const POLYGON_LIMITS = { minVertices: 3, maxVertices: 24, minAreaKm2: 20, maxAreaKm2: 12_000 } as const;
