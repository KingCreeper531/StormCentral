/** Chart geometry helpers (framework-free). */

export interface Pt {
  x: number;
  y: number;
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson), the same curve as
 * d3.curveMonotoneX: smooth, but never overshoots — a temperature curve
 * must not invent a peak that isn't in the data.
 */
export function monotonePath(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0]!.x},${pts[0]!.y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]!.x - pts[i]!.x);
    m.push((pts[i + 1]!.y - pts[i]!.y) / (dx[i] || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = m[i - 1]!;
    const b = m[i]!;
    t.push(a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b));
  }
  t.push(m[n - 2]!);
  let d = `M${pts[0]!.x.toFixed(2)},${pts[0]!.y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${(p0.x + h).toFixed(2)},${(p0.y + t[i]! * h).toFixed(2)} ${(p1.x - h).toFixed(2)},${(p1.y - t[i + 1]! * h).toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
  }
  return d;
}

/** Split a series at nulls into contiguous runs of points. */
export function segments(xs: readonly number[], ys: ReadonlyArray<number | null | undefined>, sx: (v: number) => number, sy: (v: number) => number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y == null || !Number.isFinite(y)) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    cur.push({ x: sx(xs[i]!), y: sy(y) });
  }
  if (cur.length) out.push(cur);
  return out;
}

/** "Nice" tick values covering [min, max] (Heckbert's algorithm). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = niceNum(max - min, false);
  const step = niceNum(span / Math.max(1, count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

function niceNum(range: number, round: boolean) {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/** Column with a 4 px rounded data-end and a square baseline. */
export function roundedBar(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
