/**
 * NEXRAD Level-III product catalog. Product codes are `<tilt prefix><family letter>`,
 * e.g. N0B = super-res base reflectivity at the lowest tilt. Which tilts exist
 * depends on the VCP and the dissemination list, so the UI is driven by what
 * IEM reports as available rather than by a hard-coded list.
 */

export type ProductFamily = "reflectivity" | "velocity" | "srv" | "cc" | "zdr" | "hc";

export interface LegendStop {
  value: number;
  color: string;
}

export interface FamilyDef {
  id: ProductFamily;
  label: string;
  short: string;
  unit: string;
  /** Candidate family letters in preference order (super-res first). */
  letters: string[];
  legend: LegendStop[];
  /** Pixel-exact resampling keeps gate boundaries crisp (velocity couplets!). */
  crisp: boolean;
}

export const TILTS = [
  { prefix: "N0", angle: 0.5 },
  { prefix: "NA", angle: 0.9 },
  { prefix: "N1", angle: 1.5 },
  { prefix: "NB", angle: 1.8 },
  { prefix: "N2", angle: 2.4 },
  { prefix: "N3", angle: 3.4 },
] as const;

export type TiltPrefix = (typeof TILTS)[number]["prefix"];

export const FAMILIES: Record<ProductFamily, FamilyDef> = {
  reflectivity: {
    id: "reflectivity",
    label: "Base Reflectivity",
    short: "REF",
    unit: "dBZ",
    letters: ["B", "Q", "R"],
    crisp: false,
    legend: [
      { value: 5, color: "#04e9e7" },
      { value: 10, color: "#019ff4" },
      { value: 15, color: "#0300f4" },
      { value: 20, color: "#02fd02" },
      { value: 25, color: "#01c501" },
      { value: 30, color: "#008e00" },
      { value: 35, color: "#fdf802" },
      { value: 40, color: "#e5bc00" },
      { value: 45, color: "#fd9500" },
      { value: 50, color: "#fd0000" },
      { value: 55, color: "#d40000" },
      { value: 60, color: "#bc0000" },
      { value: 65, color: "#f800fd" },
      { value: 70, color: "#9854c6" },
      { value: 75, color: "#fdfdfd" },
    ],
  },
  velocity: {
    id: "velocity",
    label: "Base Velocity",
    short: "VEL",
    unit: "kt",
    letters: ["G", "U", "V"],
    crisp: true,
    legend: [
      { value: -64, color: "#98f0c8" },
      { value: -50, color: "#00e88c" },
      { value: -36, color: "#00b400" },
      { value: -20, color: "#008700" },
      { value: -5, color: "#2b5d2b" },
      { value: 0, color: "#6e6e6e" },
      { value: 5, color: "#6e2020" },
      { value: 20, color: "#9a0000" },
      { value: 36, color: "#d80000" },
      { value: 50, color: "#ff5c5c" },
      { value: 64, color: "#ffc0a0" },
    ],
  },
  srv: {
    id: "srv",
    label: "Storm-Relative Velocity",
    short: "SRV",
    unit: "kt",
    letters: ["S"],
    crisp: true,
    legend: [
      { value: -50, color: "#00e88c" },
      { value: -26, color: "#00b400" },
      { value: -10, color: "#2b5d2b" },
      { value: 0, color: "#6e6e6e" },
      { value: 10, color: "#6e2020" },
      { value: 26, color: "#d80000" },
      { value: 50, color: "#ff5c5c" },
    ],
  },
  cc: {
    id: "cc",
    label: "Correlation Coefficient",
    short: "CC",
    unit: "ρhv",
    letters: ["C"],
    crisp: true,
    legend: [
      { value: 0.2, color: "#1b1b3a" },
      { value: 0.6, color: "#3c3ca8" },
      { value: 0.8, color: "#2fb5d6" },
      { value: 0.9, color: "#28c828" },
      { value: 0.95, color: "#ffd400" },
      { value: 0.97, color: "#ff7a00" },
      { value: 1.0, color: "#c00000" },
      { value: 1.05, color: "#ff9ef0" },
    ],
  },
  zdr: {
    id: "zdr",
    label: "Differential Reflectivity",
    short: "ZDR",
    unit: "dB",
    letters: ["X"],
    crisp: true,
    legend: [
      { value: -2, color: "#3b3b3b" },
      { value: 0, color: "#9a9a9a" },
      { value: 1, color: "#2d8ae6" },
      { value: 2, color: "#28c828" },
      { value: 3, color: "#ffe100" },
      { value: 4, color: "#ff8c00" },
      { value: 5, color: "#e60000" },
      { value: 6, color: "#ff5aaa" },
      { value: 8, color: "#ffffff" },
    ],
  },
  hc: {
    id: "hc",
    label: "Hydrometeor Classification",
    short: "HC",
    unit: "class",
    letters: ["H"],
    crisp: true,
    legend: [
      { value: 0, color: "#9c9c9c" }, // biological / clutter
      { value: 1, color: "#e7a2a2" }, // ice crystals
      { value: 2, color: "#7ec8ff" }, // dry snow
      { value: 3, color: "#2f58ff" }, // wet snow
      { value: 4, color: "#76d576" }, // light/moderate rain
      { value: 5, color: "#058b05" }, // heavy rain
      { value: 6, color: "#ffd700" }, // big drops
      { value: 7, color: "#e88e00" }, // graupel
      { value: 8, color: "#e0000f" }, // hail
    ],
  },
};

export const FAMILY_ORDER: ProductFamily[] = ["reflectivity", "velocity", "srv", "cc", "zdr", "hc"];

export interface ResolvedTilt {
  prefix: TiltPrefix;
  angle: number;
  code: string;
}

/**
 * Tilts available for a family given the set of product codes IEM reports.
 * When the product list is unknown (null) we optimistically offer the four
 * classic tilts using the preferred letter.
 */
export function resolveTilts(family: ProductFamily, available: ReadonlySet<string> | null): ResolvedTilt[] {
  const def = FAMILIES[family];
  if (!available) {
    return TILTS.filter((t) => ["N0", "N1", "N2", "N3"].includes(t.prefix)).map((t) => ({
      ...t,
      code: `${t.prefix}${def.letters[0]}`,
    }));
  }
  const out: ResolvedTilt[] = [];
  for (const t of TILTS) {
    const letter = def.letters.find((l) => available.has(`${t.prefix}${l}`));
    if (letter) out.push({ ...t, code: `${t.prefix}${letter}` });
  }
  return out;
}

export function familiesAvailable(available: ReadonlySet<string> | null): ProductFamily[] {
  return FAMILY_ORDER.filter((f) => resolveTilts(f, available).length > 0);
}

export function legendGradient(stops: readonly LegendStop[]) {
  const min = stops[0]!.value;
  const max = stops[stops.length - 1]!.value;
  const parts = stops.map((s) => `${s.color} ${(((s.value - min) / (max - min)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
