/**
 * Turning parsed layers into what the map draws (components/map/layers/
 * gis-layers.tsx). MapLibre can't offset a label by a per-feature pixel
 * amount in any direction, so a placefile's text offset becomes an anchor
 * on the matching side plus a radial distance in ems.
 */
import type { FeatureCollection } from "geojson";
import { isSymbol } from "./symbols";
import type { GisData } from "./types";

export type TextAnchor = "center" | "left" | "right" | "top" | "bottom";

/** `dx`/`dy` in screen pixels (y down) → which side of the point the text goes and how far. */
export function textPlacement(dx: number, dy: number, size: number): { anchor: TextAnchor; radial: number } {
  if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return { anchor: "center", radial: 0 };
  const radial = Math.hypot(dx, dy) / Math.max(6, size);
  if (Math.abs(dx) >= Math.abs(dy)) return { anchor: dx > 0 ? "left" : "right", radial };
  return { anchor: dy > 0 ? "top" : "bottom", radial };
}

/** Icon offsets drawn into an image are kept to this many pixels, so one odd value can't make a huge image. */
const MAX_OFFSET = 128;
const offset = (v: number) => Math.round(Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, v)));

/**
 * The map image for an icon feature. MapLibre can't offset icons by a
 * per-feature amount, so a placefile icon's pixel offset is drawn into its
 * image: one image per sheet cell and offset. Symbols are the same for
 * every layer.
 */
export function iconImageId(layerId: string, p: { icon: string; dx: number; dy: number }): string {
  if (isSymbol(p.icon)) return `gis-${p.icon}`;
  const dx = offset(p.dx);
  const dy = offset(p.dy);
  return `gis-${layerId}-${p.icon}${dx || dy ? `@${dx},${dy}` : ""}`;
}

export interface IconImage {
  id: string;
  icon: string;
  dx: number;
  dy: number;
}

/** Every distinct icon image a layer needs. */
export function iconImages(layerId: string, data: GisData): IconImage[] {
  const out = new Map<string, IconImage>();
  for (const f of data.features) {
    const p = f.properties;
    if (p.kind !== "icon") continue;
    const id = iconImageId(layerId, p);
    if (!out.has(id)) out.set(id, { id, icon: p.icon, dx: isSymbol(p.icon) ? 0 : offset(p.dx), dy: isSymbol(p.icon) ? 0 : offset(p.dy) });
  }
  return [...out.values()];
}

/**
 * The image for a `w`×`h` icon centred on its point: GRLevelX puts the
 * icon's hotspot on the point (shifted `dx`, `dy` px) and turns it around
 * the hotspot, so the image is padded until the point is its centre. Its
 * size and where the cell goes in it.
 */
export function iconFrame(w: number, h: number, hotX: number, hotY: number, dx: number, dy: number): { width: number; height: number; x: number; y: number } {
  const left = dx - Math.max(0, Math.min(w, hotX));
  const top = dy - Math.max(0, Math.min(h, hotY));
  const halfW = Math.max(1, Math.ceil(Math.max(Math.abs(left), Math.abs(left + w))));
  const halfH = Math.max(1, Math.ceil(Math.max(Math.abs(top), Math.abs(top + h))));
  return { width: halfW * 2, height: halfH * 2, x: halfW + left, y: halfH + top };
}

/**
 * Some sheets have no transparency at all, just icons on black (IEM's storm
 * attributes); GRLevelX shows those without the black. When every pixel of
 * an icon is opaque, black becomes see-through, with dark edges fading so
 * the outlines stay smooth. Returns whether it changed anything.
 */
export function clearBlackBackground(px: Uint8ClampedArray): boolean {
  for (let i = 3; i < px.length; i += 4) if (px[i]! < 255) return false;
  const DARK = 48;
  for (let i = 0; i < px.length; i += 4) {
    const m = Math.max(px[i]!, px[i + 1]!, px[i + 2]!);
    if (m >= DARK) continue;
    const a = Math.round((m / DARK) * 255);
    px[i + 3] = a;
    // What was blended with black, un-blended, so faded edges keep their colour.
    if (a) for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, Math.round((px[i + k]! * 255) / a));
  }
  return true;
}

/** Thresholds as distinct zooms (one set of map layers each), rounded so near-equal ones share. */
export function minzoomBuckets(data: GisData): number[] {
  return [...new Set(data.features.map((f) => Math.round(f.properties.minzoom * 4) / 4))].sort((a, b) => a - b);
}

/** Map-ready features: icon image ids, label anchors and zoom buckets added. */
export function prepareFeatures(layerId: string, data: GisData): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.features.map((f) => {
      const p = f.properties;
      const mz = Math.round(p.minzoom * 4) / 4;
      if (p.kind === "icon") return { ...f, properties: { ...p, mz, image: iconImageId(layerId, p) } };
      if (p.kind === "text") return { ...f, properties: { ...p, mz, ...textPlacement(p.dx, p.dy, p.size) } };
      return { ...f, properties: { ...p, mz } };
    }),
  };
}

/** Where icon `n` (from 1, left to right then down) sits in a sheet `sheetW` wide; null when the sheet has no such cell. */
export function iconCell(sheetW: number, sheetH: number, w: number, h: number, n: number): { x: number; y: number } | null {
  const cols = Math.floor(sheetW / w);
  const rows = Math.floor(sheetH / h);
  if (cols < 1 || rows < 1 || !Number.isInteger(n) || n < 1 || n > cols * rows) return null;
  return { x: ((n - 1) % cols) * w, y: Math.floor((n - 1) / cols) * h };
}
