/**
 * Map style presets (lib/map/style.ts): a few built in, the person's own
 * (saved by name on the device), and share codes that carry a style in a
 * link (`?mapstyle=…`) or as text to paste. A code only holds what differs
 * from the default, as JSON in base64url, and everything read from one goes
 * through `normalizeMapStyle`.
 */
import { DEFAULT_MAP_STYLE, normalizeMapStyle, type MapStyle } from "./style";

export interface MapPreset {
  id: string;
  name: string;
  style: MapStyle;
}

export const LIMITS = { saved: 20, name: 40, code: 2000 } as const;

const preset = (id: string, name: string, patch: Partial<MapStyle>): MapPreset => ({ id, name, style: normalizeMapStyle({ ...DEFAULT_MAP_STYLE, ...patch }) });

/** Built-in starting points; names are translated where they're shown. */
export const BUILTIN_PRESETS: readonly MapPreset[] = [
  preset("standard", "Standard", {}),
  preset("chaser", "Chaser", {
    basemap: "dark",
    hillshade: 0.3,
    counties: { show: "always", color: null, width: 1 },
    roads: "major",
    roadColor: "#facc15",
    poiLabels: false,
    labelSize: 1.1,
  }),
  preset("broadcast", "Broadcast", {
    basemap: "dark",
    states: { show: true, color: "#ffffff", width: 2 },
    counties: { show: "always", color: "#6b7280", width: 1 },
    roads: "off",
    roadLabels: false,
    poiLabels: false,
    landcover: false,
    buildings: false,
    labelSize: 1.3,
  }),
  preset("terrain", "Terrain", { hillshade: 0.8, terrain3d: true, exaggeration: 2 }),
  preset("minimal", "Minimal", {
    counties: { show: "off", color: null, width: 1 },
    roads: "off",
    roadLabels: false,
    waterLabels: false,
    poiLabels: false,
    landcover: false,
    buildings: false,
  }),
  preset("light", "Light", { basemap: "light", states: { show: true, color: "#374151", width: 1.25 } }),
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The preset the style is exactly, if any (so its button can show as picked). */
export function matchingPreset(style: MapStyle, presets: readonly MapPreset[]): MapPreset | undefined {
  const s = normalizeMapStyle(style);
  return presets.find((p) => same(p.style, s));
}

/** A name for people to see: plain text, trimmed, at most 40 characters. */
export const cleanName = (name: unknown) =>
  String(name ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.name);

/** Only what differs from the default. */
function diff(style: MapStyle): Partial<MapStyle> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(normalizeMapStyle(style))) if (!same(v, DEFAULT_MAP_STYLE[k as keyof MapStyle])) out[k] = v;
  return out as Partial<MapStyle>;
}

const toBase64Url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** A share code for a style and its name. */
export function encodeStyle(name: string, style: MapStyle): string {
  return toBase64Url(JSON.stringify({ v: 1, n: cleanName(name), s: diff(style) }));
}

/** A style and name from a share code (or a whole link holding one), or null when it isn't one. */
export function decodeStyle(input: string): { name: string; style: MapStyle } | null {
  let code = input.trim();
  const inLink = code.match(/[?&#]mapstyle=([\w-]+)/);
  if (inLink) code = inLink[1]!;
  if (!code || code.length > LIMITS.code || !/^[\w-]+$/.test(code)) return null;
  try {
    const raw = JSON.parse(fromBase64Url(code)) as { v?: unknown; n?: unknown; s?: unknown };
    if (raw?.v !== 1 || typeof raw.s !== "object" || raw.s === null) return null;
    return { name: cleanName(raw.n) || "Shared style", style: normalizeMapStyle({ ...DEFAULT_MAP_STYLE, ...(raw.s as object) }) };
  } catch {
    return null;
  }
}

/** Saved presets from storage made safe: known shapes, plain names, at most 20. */
export function cleanPresets(raw: unknown): MapPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: MapPreset[] = [];
  for (const p of raw.slice(0, LIMITS.saved) as Partial<MapPreset>[]) {
    if (!p || typeof p !== "object") continue;
    const name = cleanName(p.name);
    if (!name) continue;
    out.push({
      id: typeof p.id === "string" && /^[\w-]{1,40}$/.test(p.id) ? p.id : `mp-${Math.random().toString(36).slice(2, 10)}`,
      name,
      style: normalizeMapStyle(p.style),
    });
  }
  return out;
}
