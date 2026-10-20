/**
 * Drawing on the map (a telestrator): freehand pen strokes, lines, arrows,
 * circles and text labels, pinned to map coordinates so they stay on the
 * storm when the map moves. The same shapes travel to the live stream
 * (/api/live-drawing) and come from its own annotations (stream/plan.ts),
 * so everything here is pure and checked: anything from outside goes
 * through `cleanShapes` first.
 */
import type { Feature, FeatureCollection } from "geojson";
import { destination, haversineKm, mercatorY } from "../geo";

export type DrawKind = "pen" | "line" | "arrow" | "circle" | "text";
export const DRAW_KINDS: readonly DrawKind[] = ["pen", "line", "arrow", "circle", "text"];

/** Bright enough on radar and the dark map: red, yellow, white, teal, violet. */
export const DRAW_COLORS = ["#ff3b3b", "#ffd60a", "#ffffff", "#2dd4bf", "#c084fc"] as const;
export const DRAW_WIDTHS = [3, 6] as const;

export type LonLat = [number, number];

export interface Shape {
  id: string;
  kind: DrawKind;
  color: string;
  width: number;
  /** pen: the stroke; line, arrow: start and end; circle: centre and a point on the edge; text: where it sits. */
  points: LonLat[];
  text?: string;
}

export const LIMITS = { shapes: 200, points: 800, text: 60 } as const;

/** A circle as a ring through its edge point, `n` segments. */
export function circleRing(center: LonLat, edge: LonLat, n = 64): LonLat[] {
  const c = { lat: center[1], lon: center[0] };
  const km = haversineKm(c, { lat: edge[1], lon: edge[0] });
  const ring: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const p = destination(c, (i / n) * 360, km);
    ring.push([p.lon, p.lat]);
  }
  return ring;
}

/** The direction from a to b as it looks on the (north-up, Web Mercator) map, degrees clockwise from up. */
export function screenBearing(a: LonLat, b: LonLat): number {
  const dx = ((b[0] - a[0]) * Math.PI) / 180;
  const dy = mercatorY(b[1]) - mercatorY(a[1]);
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Ramer–Douglas–Peucker on screen points: keeps a stroke's shape with far fewer points. */
export function simplify<P extends { x: number; y: number }>(pts: readonly P[], tolerance: number): P[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a]!;
    const B = pts[b]!;
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i]!;
      const d = Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y)) / len;
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst > 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Map features for the drawing layers: lines (with casing), arrowheads and labels. */
export function shapesToGeoJSON(shapes: readonly Shape[]): FeatureCollection {
  const features: Feature[] = [];
  for (const s of shapes) {
    const props = { id: s.id, color: s.color, width: s.width };
    if (s.kind === "text") {
      if (s.points[0] && s.text) features.push({ type: "Feature", geometry: { type: "Point", coordinates: s.points[0] }, properties: { ...props, kind: "text", text: s.text } });
      continue;
    }
    const line = s.kind === "circle" && s.points.length >= 2 ? circleRing(s.points[0]!, s.points[1]!) : s.points;
    if (line.length < 2) continue;
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { ...props, kind: "line" } });
    if (s.kind === "arrow") {
      const a = line.at(-2)!;
      const b = line.at(-1)!;
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: b }, properties: { ...props, kind: "head", bearing: screenBearing(a, b) } });
    }
  }
  return { type: "FeatureCollection", features };
}

const isLonLat = (p: unknown): p is LonLat => Array.isArray(p) && p.length === 2 && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const COLORS = new Set<string>(DRAW_COLORS);

/** Shapes from anywhere (storage, the network) made safe: known kinds and colours, bounded sizes, plain text. Invalid ones are dropped. */
export function cleanShapes(input: unknown): Shape[] {
  if (!Array.isArray(input)) return [];
  const out: Shape[] = [];
  for (const raw of input.slice(0, LIMITS.shapes)) {
    const s = raw as Partial<Shape>;
    if (!s || typeof s !== "object" || !DRAW_KINDS.includes(s.kind as DrawKind) || !Array.isArray(s.points)) continue;
    const points = s.points.filter(isLonLat).slice(0, LIMITS.points).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as LonLat);
    const need = s.kind === "text" ? 1 : 2;
    if (points.length < need) continue;
    const text = s.kind === "text" ? String(s.text ?? "").replace(/\p{Cc}/gu, " ").trim().slice(0, LIMITS.text) : undefined;
    if (s.kind === "text" && !text) continue;
    out.push({
      id: typeof s.id === "string" && /^[\w-]{1,40}$/.test(s.id) ? s.id : Math.random().toString(36).slice(2, 10),
      kind: s.kind as DrawKind,
      color: COLORS.has(s.color as string) ? (s.color as string) : DRAW_COLORS[0],
      width: (DRAW_WIDTHS as readonly number[]).includes(s.width as number) ? (s.width as number) : DRAW_WIDTHS[0],
      points: s.kind === "text" ? points.slice(0, 1) : s.kind === "pen" ? points : points.slice(0, 2),
      ...(text ? { text } : {}),
    });
  }
  return out;
}
