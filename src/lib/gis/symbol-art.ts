/**
 * Drawings of the custom-layer symbols (lib/gis/symbols), plus the pin that
 * stands in for an icon whose sheet couldn't be read. Drawn at 2× in
 * logical pixels, centred on the point they mark, so the map (addImage
 * with pixelRatio 2) and the layer list's legend show the same thing.
 */
import type { SymbolId } from "./symbols";

export type ArtId = SymbolId | "pin";
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const SYMBOL_RATIO = 2;

/** Green, amber, grey: how recently a spotter reported. */
export const SPOTTER_COLORS = { "spotter-live": "#34d399", "spotter-recent": "#fbbf24", "spotter-old": "#9ca3af" } as const;
const RIM = "rgba(0,0,0,0.85)";
const INK = "#0b0d12";

/** Logical size; the point is the centre. The arrow and pin reach out from it, so they're larger. */
export const ART_SIZE: Record<ArtId, { w: number; h: number }> = {
  "spotter-live": { w: 22, h: 22 },
  "spotter-recent": { w: 22, h: 22 },
  "spotter-old": { w: 22, h: 22 },
  heading: { w: 34, h: 34 },
  pin: { w: 20, h: 52 },
};

/** A person (head and shoulders) on a disc. */
function badge(g: Ctx, cx: number, cy: number, color: string) {
  g.beginPath();
  g.arc(cx, cy, 9.5, 0, Math.PI * 2);
  g.fillStyle = RIM;
  g.fill();
  g.beginPath();
  g.arc(cx, cy, 8, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(cx, cy - 2.6, 2.9, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(cx, cy + 7, 5.6, 4.6, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** An arrowhead pointing up (north) from just outside a badge on the centre; the map rotates it by heading. */
function arrow(g: Ctx, cx: number, cy: number) {
  g.beginPath();
  g.moveTo(cx, cy - 16.5);
  g.lineTo(cx + 5.8, cy - 7.6);
  g.lineTo(cx, cy - 9.6);
  g.lineTo(cx - 5.8, cy - 7.6);
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 1.6;
  g.strokeStyle = RIM;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.fill();
}

/** A map pin whose tip is the centre. */
function pin(g: Ctx, cx: number, cy: number) {
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy - 14, 8, Math.PI * 0.8, Math.PI * 2.2);
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 1.6;
  g.strokeStyle = RIM;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.fill();
  g.beginPath();
  g.arc(cx, cy - 14, 3, 0, Math.PI * 2);
  g.fillStyle = INK;
  g.fill();
}

/** Paint a symbol in logical pixels into a context already scaled for the screen. */
export function paintSymbol(g: Ctx, id: ArtId) {
  const { w, h } = ART_SIZE[id];
  if (id === "heading") arrow(g, w / 2, h / 2);
  else if (id === "pin") pin(g, w / 2, h / 2);
  else badge(g, w / 2, h / 2, SPOTTER_COLORS[id]);
}

/** A symbol's pixels for map.addImage(…, { pixelRatio: SYMBOL_RATIO }). */
export function drawSymbol(id: ArtId): ImageData | null {
  const { w, h } = ART_SIZE[id];
  const c = new OffscreenCanvas(w * SYMBOL_RATIO, h * SYMBOL_RATIO);
  const g = c.getContext("2d");
  if (!g) return null;
  g.scale(SYMBOL_RATIO, SYMBOL_RATIO);
  paintSymbol(g, id);
  return g.getImageData(0, 0, c.width, c.height);
}

/** The legend's 22 px swatch: a symbol, or for the arrow a live spotter heading north-east. */
export function paintSwatch(g: Ctx, id: SymbolId) {
  if (id !== "heading") return paintSymbol(g, id);
  const s = 22 / ART_SIZE.heading.w;
  g.save();
  g.scale(s, s);
  badge(g, 17, 17, SPOTTER_COLORS["spotter-live"]);
  g.translate(17, 17);
  g.rotate(Math.PI / 4);
  g.translate(-17, -17);
  arrow(g, 17, 17);
  g.restore();
}
