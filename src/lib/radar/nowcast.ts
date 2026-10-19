/**
 * Future radar by extrapolation (a "nowcast"): how the echoes moved between
 * two recent scans, carried an hour forward. The same method radar nowcasts
 * are built on (pySTEPS' extrapolation, TITAN-style field tracking):
 *  1. each scan's colours become an echo-intensity grid;
 *  2. block matching: for each block of the newer scan, the shift of the older
 *     scan that fits it best (least mean absolute difference, refined to a
 *     fraction of a pixel by a parabola through the minimum) is its motion;
 *  3. the vectors are cleaned: a 3×3 median drops outliers, blocks without
 *     echoes borrow from their neighbours, and a field that disagrees with
 *     itself (or has too few blocks) falls back to the mean motion;
 *  4. semi-Lagrangian advection: each future pixel traces back along the
 *     motion field to where its echo was in the newest scan.
 * Echoes keep their strength and shape: no growth, decay or new storms.
 *
 * Plain functions on plain arrays, so it's tested in Node. The worker
 * (nowcast.worker.ts) fetches and draws the scans, use-nowcast.ts shows them.
 */

/** Minutes between future frames, and how far ahead they go. */
export const NOWCAST_STEP_MIN = 10;
export const NOWCAST_MAX_MIN = 60;
/** Lead times of the future frames: 10, 20 … 60 minutes. */
export const NOWCAST_LEADS = Array.from({ length: NOWCAST_MAX_MIN / NOWCAST_STEP_MIN }, (_, i) => (i + 1) * NOWCAST_STEP_MIN);

// ── Echo intensity ──────────────────────────────────────────────────────────

/**
 * Echo strength from radar colours, roughly along the reflectivity scale:
 * blue 1 → green 2 → yellow 3 → red 4 → magenta or white 5, scaled by
 * opacity; 0 where there's no echo. Any of the radar palettes in use (IEM,
 * NOAA) runs from cool to warm colours, which is all block matching needs.
 */
export function echoIntensity(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = rgba[p + 3]!;
    if (a < 32) continue;
    const r = rgba[p]! / 255;
    const g = rgba[p + 1]! / 255;
    const b = rgba[p + 2]! / 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let rank: number;
    if (d < 0.15) rank = max > 0.8 ? 5 : 1;
    else {
      let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
      rank = hue >= 300 ? 5 : hue >= 150 ? 1 + (240 - Math.min(240, hue)) / 90 : hue >= 60 ? 2 + (150 - hue) / 90 : 3 + (60 - hue) / 60;
    }
    out[i] = (a / 255) * rank;
  }
  return out;
}

/** Fraction of the grid with any echo. */
export function echoCover(intensity: Float32Array): number {
  let n = 0;
  for (let i = 0; i < intensity.length; i++) if (intensity[i]! > 0) n++;
  return intensity.length ? n / intensity.length : 0;
}

/** Box-average by `f` (w×h → ⌊w/f⌋×⌊h/f⌋). */
export function downsample(src: Float32Array, w: number, h: number, f: number): { data: Float32Array; w: number; h: number } {
  if (f <= 1) return { data: src, w, h };
  const dw = Math.max(1, Math.floor(w / f));
  const dh = Math.max(1, Math.floor(h / f));
  const out = new Float32Array(dw * dh);
  const k = 1 / (f * f);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) s += src[(y * f + yy) * w + x * f + xx]!;
      out[y * dw + x] = s * k;
    }
  return { data: out, w: dw, h: dh };
}

// ── Motion ──────────────────────────────────────────────────────────────────

/**
 * A motion field on a grid of square blocks, in pixels of the full grid per
 * the time between the two scans. Block (bx, by) is centred at
 * (ox + (bx + ½)·block, oy + (by + ½)·block).
 */
export interface Motion {
  cols: number;
  rows: number;
  block: number;
  ox: number;
  oy: number;
  u: Float32Array;
  v: Float32Array;
  /** 1 where the block had echoes and a clear best match. */
  valid: Uint8Array;
}

export interface MatchOptions {
  /** Block edge in px. */
  block?: number;
  /** Largest shift tried, in px each way. */
  search?: number;
  /** Least share of a block with echoes for it to get a vector. */
  minCover?: number;
}

/** Best shift of `prev` for the region of `next` at (x0, y0, bw, bh); null when it's flat or ambiguous. */
function matchRegion(prev: Float32Array, next: Float32Array, w: number, h: number, x0: number, y0: number, bw: number, bh: number, search: number) {
  const side = 2 * search + 1;
  const cost = new Float64Array(side * side).fill(Number.NaN);
  let best = Infinity;
  let bi = -1;
  let sum = 0;
  let count = 0;
  for (let dy = -search; dy <= search; dy++)
    for (let dx = -search; dx <= search; dx++) {
      let s = 0;
      let n = 0;
      for (let y = y0; y < y0 + bh; y++) {
        const sy = y - dy;
        if (sy < 0 || sy >= h) continue;
        const row = y * w;
        const srow = sy * w;
        for (let x = x0; x < x0 + bw; x++) {
          const sx = x - dx;
          if (sx < 0 || sx >= w) continue;
          s += Math.abs(next[row + x]! - prev[srow + sx]!);
          n++;
        }
      }
      // Shifts that leave most of the block outside the older scan prove nothing.
      if (n < bw * bh * 0.5) continue;
      const c = s / n;
      const i = (dy + search) * side + dx + search;
      cost[i] = c;
      sum += c;
      count++;
      // Ties go to the smaller shift.
      if (c < best - 1e-9 || (Math.abs(c - best) <= 1e-9 && dx * dx + dy * dy < shiftSq(bi, side, search))) {
        best = c;
        bi = i;
      }
    }
  if (bi < 0 || !count) return null;
  // A minimum that barely stands out from the rest is texture-free (a uniform shield) or ambiguous.
  if (best > 0.85 * (sum / count)) return null;
  const bx = (bi % side) - search;
  const by = Math.floor(bi / side) - search;
  const refine = (l: number, c: number, r: number) => {
    const den = l - 2 * c + r;
    return Number.isFinite(den) && den > 1e-9 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den))) : 0;
  };
  const at = (dx: number, dy: number) => (Math.abs(dx) > search || Math.abs(dy) > search ? Number.NaN : cost[(dy + search) * side + dx + search]!);
  return { u: bx + refine(at(bx - 1, by), best, at(bx + 1, by)), v: by + refine(at(bx, by - 1), best, at(bx, by + 1)) };
}

function shiftSq(i: number, side: number, search: number) {
  if (i < 0) return Infinity;
  const dx = (i % side) - search;
  const dy = Math.floor(i / side) - search;
  return dx * dx + dy * dy;
}

/** Block-matching motion from `prev` to `next` (echo intensities, both w×h): next(x) ≈ prev(x − motion). */
export function estimateMotion(prev: Float32Array, next: Float32Array, w: number, h: number, { block = 24, search = 14, minCover = 0.1 }: MatchOptions = {}): Motion {
  const cols = Math.max(1, Math.floor(w / block));
  const rows = Math.max(1, Math.floor(h / block));
  const bw = Math.min(block, w);
  const bh = Math.min(block, h);
  const m: Motion = {
    cols,
    rows,
    block,
    ox: Math.floor((w - cols * bw) / 2),
    oy: Math.floor((h - rows * bh) / 2),
    u: new Float32Array(cols * rows),
    v: new Float32Array(cols * rows),
    valid: new Uint8Array(cols * rows),
  };
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      const x0 = m.ox + bx * bw;
      const y0 = m.oy + by * bh;
      let echoes = 0;
      for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) if (next[y * w + x]! > 0) echoes++;
      if (echoes < minCover * bw * bh) continue;
      const hit = matchRegion(prev, next, w, h, x0, y0, bw, bh, search);
      if (!hit) continue;
      const i = by * cols + bx;
      m.u[i] = hit.u;
      m.v[i] = hit.v;
      m.valid[i] = 1;
    }
  return m;
}

/** One motion for the whole grid: the fallback when too few blocks have echoes of their own. */
export function globalMotion(prev: Float32Array, next: Float32Array, w: number, h: number, search = 14): { u: number; v: number } | null {
  return matchRegion(prev, next, w, h, 0, 0, w, h, search);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
};

export const validCount = (m: Motion) => m.valid.reduce((n, x) => n + x, 0);

export function meanMotion(m: Motion): { u: number; v: number } {
  let u = 0;
  let v = 0;
  let n = 0;
  for (let i = 0; i < m.valid.length; i++)
    if (m.valid[i]) {
      u += m.u[i]!;
      v += m.v[i]!;
      n++;
    }
  return n ? { u: u / n, v: v / n } : { u: 0, v: 0 };
}

/** The same field with every block moving `u, v`. */
export function uniformMotion(m: Pick<Motion, "cols" | "rows" | "block" | "ox" | "oy">, u: number, v: number): Motion {
  const n = m.cols * m.rows;
  return { cols: m.cols, rows: m.rows, block: m.block, ox: m.ox, oy: m.oy, u: new Float32Array(n).fill(u), v: new Float32Array(n).fill(v), valid: new Uint8Array(n).fill(1) };
}

/**
 * Outliers out, gaps filled: each valid block takes the median of the valid
 * blocks around it (3×3); blocks without a vector take the inverse-distance
 * weighted mean of the valid ones.
 */
export function cleanMotion(m: Motion): Motion {
  const { cols, rows } = m;
  const u = new Float32Array(m.u);
  const v = new Float32Array(m.v);
  const valid = m.valid;
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      const i = by * cols + bx;
      if (!valid[i]) continue;
      const us: number[] = [];
      const vs: number[] = [];
      for (let y = Math.max(0, by - 1); y <= Math.min(rows - 1, by + 1); y++)
        for (let x = Math.max(0, bx - 1); x <= Math.min(cols - 1, bx + 1); x++)
          if (valid[y * cols + x]) {
            us.push(m.u[y * cols + x]!);
            vs.push(m.v[y * cols + x]!);
          }
      if (us.length >= 3) {
        u[i] = median(us);
        v[i] = median(vs);
      }
    }
  const known: number[] = [];
  for (let i = 0; i < valid.length; i++) if (valid[i]) known.push(i);
  if (known.length)
    for (let i = 0; i < valid.length; i++) {
      if (valid[i]) continue;
      const bx = i % cols;
      const by = Math.floor(i / cols);
      let su = 0;
      let sv = 0;
      let sw = 0;
      for (const k of known) {
        const dx = (k % cols) - bx;
        const dy = Math.floor(k / cols) - by;
        const wgt = 1 / (dx * dx + dy * dy);
        su += wgt * u[k]!;
        sv += wgt * v[k]!;
        sw += wgt;
      }
      u[i] = su / sw;
      v[i] = sv / sw;
    }
  return { ...m, u, v, valid: new Uint8Array(valid) };
}

/**
 * Whether a cleaned field can be trusted block by block: enough blocks, and
 * they roughly agree. Otherwise the mean motion is the better guess.
 */
export function fieldIsReliable(m: Motion): boolean {
  const n = validCount(m);
  if (n < 3) return false;
  const mean = meanMotion(m);
  let dev = 0;
  for (let i = 0; i < m.valid.length; i++) if (m.valid[i]) dev += (m.u[i]! - mean.u) ** 2 + (m.v[i]! - mean.v) ** 2;
  return Math.sqrt(dev / n) <= Math.max(3, 1.5 * Math.hypot(mean.u, mean.v));
}

/** Bilinear motion at full-grid pixel (x, y), written into `out` (advection samples millions of times: no allocation). */
function sampleInto(m: Motion, x: number, y: number, out: Float64Array) {
  const gx = Math.max(0, Math.min(m.cols - 1, (x - m.ox) / m.block - 0.5));
  const gy = Math.max(0, Math.min(m.rows - 1, (y - m.oy) / m.block - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(m.cols - 1, x0 + 1);
  const y1 = Math.min(m.rows - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const i00 = y0 * m.cols + x0;
  const i10 = y0 * m.cols + x1;
  const i01 = y1 * m.cols + x0;
  const i11 = y1 * m.cols + x1;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  out[0] = m.u[i00]! * w00 + m.u[i10]! * w10 + m.u[i01]! * w01 + m.u[i11]! * w11;
  out[1] = m.v[i00]! * w00 + m.v[i10]! * w10 + m.v[i01]! * w01 + m.v[i11]! * w11;
}

/** Bilinear motion at full-grid pixel (x, y). */
export function sampleMotion(m: Motion, x: number, y: number): [number, number] {
  const out = new Float64Array(2);
  sampleInto(m, x, y, out);
  return [out[0]!, out[1]!];
}

/**
 * The motion between two scans' echo intensities (w×h), ready to advect:
 * matched on a grid coarsened by `factor` (fast, and large enough shifts fit
 * the search window), cleaned, and the mean motion when the field isn't
 * reliable. Null when there's too little echo to tell.
 */
export function motionField(prev: Float32Array, next: Float32Array, w: number, h: number, factor = 1, opts: MatchOptions = {}): Motion | null {
  if (echoCover(next) < 0.002 || echoCover(prev) < 0.002) return null;
  const a = downsample(prev, w, h, factor);
  const b = downsample(next, w, h, factor);
  const raw = estimateMotion(a.data, b.data, a.w, a.h, opts);
  let m: Motion;
  if (validCount(raw) >= 3) {
    const clean = cleanMotion(raw);
    m = fieldIsReliable(clean) ? clean : uniformMotion(clean, meanMotion(clean).u, meanMotion(clean).v);
  } else {
    const g = globalMotion(a.data, b.data, a.w, a.h, opts.search ?? 14);
    if (!g) return null;
    m = uniformMotion(raw, g.u, g.v);
  }
  // Back to full-grid pixels.
  const scale = (arr: Float32Array) => arr.map((x) => x * factor);
  return { ...m, block: m.block * factor, ox: m.ox * factor, oy: m.oy * factor, u: scale(m.u), v: scale(m.v) };
}

/**
 * The newest scan `steps` time steps ahead: each pixel traces back along the
 * field (`perStep` of the motion per step) to where its echo was, and keeps
 * its colour (nearest pixel, so palette colours stay exact) with its opacity
 * scaled by `fade`. Pixels that trace back off the grid are left empty.
 */
export function advect(rgba: ArrayLike<number>, w: number, h: number, m: Motion, steps: number, perStep: number, fade = 1): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4);
  const uv = new Float64Array(2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let px = x + 0.5;
      let py = y + 0.5;
      for (let s = 0; s < steps; s++) {
        sampleInto(m, px, py, uv);
        px -= uv[0]! * perStep;
        py -= uv[1]! * perStep;
      }
      const sx = Math.floor(px);
      const sy = Math.floor(py);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const src = (sy * w + sx) * 4;
      const a = rgba[src + 3]!;
      if (!a) continue;
      const dst = (y * w + x) * 4;
      out[dst] = rgba[src]!;
      out[dst + 1] = rgba[src + 1]!;
      out[dst + 2] = rgba[src + 2]!;
      out[dst + 3] = a * fade;
    }
  return out;
}

/**
 * Every frame from one step ahead to `steps` ahead, as `advect` would make
 * them, but tracing each pixel one step further per frame instead of from
 * the start each time. Frame `s` has its opacity scaled by `fade(s)`.
 */
export function* advectFrames(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  m: Motion,
  steps: number,
  perStep: number,
  fade: (step: number) => number = () => 1,
): Generator<Uint8ClampedArray<ArrayBuffer>> {
  const n = w * h;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = (i % w) + 0.5;
    ys[i] = Math.floor(i / w) + 0.5;
  }
  const uv = new Float64Array(2);
  for (let s = 1; s <= steps; s++) {
    const out = new Uint8ClampedArray(n * 4);
    const f = fade(s);
    for (let i = 0; i < n; i++) {
      sampleInto(m, xs[i]!, ys[i]!, uv);
      xs[i] = xs[i]! - uv[0]! * perStep;
      ys[i] = ys[i]! - uv[1]! * perStep;
      const sx = Math.floor(xs[i]!);
      const sy = Math.floor(ys[i]!);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const src = (sy * w + sx) * 4;
      const a = rgba[src + 3]!;
      if (!a) continue;
      const dst = i * 4;
      out[dst] = rgba[src]!;
      out[dst + 1] = rgba[src + 1]!;
      out[dst + 2] = rgba[src + 2]!;
      out[dst + 3] = a * f;
    }
    yield out;
  }
}

/** Opacity of the frame `leadMin` ahead: a little fainter the further out, as the guess gets rougher. */
export const leadFade = (leadMin: number) => 1 - 0.05 * (leadMin / NOWCAST_STEP_MIN);

/** The timeline's label for a future radar frame: "+30 min · Future". */
export const nowcastLabel = (leadMin: number, t: (s: string, vars: Record<string, string | number>) => string) => t("+{n} min · Future", { n: leadMin });

// ── Which scans ─────────────────────────────────────────────────────────────

/**
 * The two scans to measure motion between: the newest, and the one closest to
 * `targetMs` before it (4–40 min back; a longer gap measures motion more
 * precisely), else the one just before it.
 */
export function motionPair<T extends { time: number }>(frames: readonly T[], targetMs = 15 * 60_000): [T, T] | null {
  const newest = frames.at(-1);
  if (!newest || frames.length < 2) return null;
  let best: T | null = null;
  let err = Infinity;
  for (const f of frames.slice(0, -1)) {
    const gap = newest.time - f.time;
    if (gap < 4 * 60_000 || gap > 40 * 60_000) continue;
    const e = Math.abs(gap - targetMs);
    if (e < err) {
      best = f;
      err = e;
    }
  }
  if (!best) {
    const prev = frames.at(-2)!;
    const gap = newest.time - prev.time;
    if (gap >= 2 * 60_000 && gap <= 60 * 60_000) best = prev;
  }
  return best ? [best, newest] : null;
}

// ── The grid on the map ─────────────────────────────────────────────────────

const R = 6378137;
/** Web Mercator's world width in metres. */
export const WORLD_M = 2 * Math.PI * R;
const MAX_LAT = 85.05;
const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
export const lonToX = (lon: number) => (R * lon * Math.PI) / 180;
export const latToY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * Math.PI) / 360));
export const xToLon = (x: number) => (x / R) * (180 / Math.PI);
export const yToLat = (y: number) => (Math.atan(Math.exp(y / R)) * 2 - Math.PI / 2) * (180 / Math.PI);

/** A Web Mercator pixel grid over part of the map: bounds in metres, size in px. */
export interface Grid {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
}

/**
 * The grid for a map view (`[west, south, east, north]` in degrees): the view
 * plus `margin` on each side, so echoes about to move in are tracked too, at
 * most `maxPx` on its longer side.
 */
export function viewGrid([w, s, e, n]: readonly [number, number, number, number], maxPx = 768, margin = 0.15): Grid {
  let west = lonToX(Math.max(-180, w));
  let east = lonToX(Math.min(180, e));
  let south = latToY(s);
  let north = latToY(n);
  const mx = (east - west) * margin;
  const my = (north - south) * margin;
  west = Math.max(-WORLD_M / 2, west - mx);
  east = Math.min(WORLD_M / 2, east + mx);
  south = Math.max(latToY(-MAX_LAT), south - my);
  north = Math.min(latToY(MAX_LAT), north + my);
  const aspect = (east - west) / Math.max(1, north - south);
  const width = Math.max(16, Math.round(aspect >= 1 ? maxPx : maxPx * aspect));
  const height = Math.max(16, Math.round(aspect >= 1 ? maxPx / aspect : maxPx));
  return { west, south, east, north, width, height };
}

/** Corners for a MapLibre image source: top-left, top-right, bottom-right, bottom-left. */
export function gridCorners(g: Grid): [[number, number], [number, number], [number, number], [number, number]] {
  const w = xToLon(g.west);
  const e = xToLon(g.east);
  const n = yToLat(g.north);
  const s = yToLat(g.south);
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
}

/** Ground distance across one grid pixel at the grid's middle latitude, km. */
export function kmPerPixel(g: Grid): number {
  const lat = yToLat((g.north + g.south) / 2);
  return (((g.east - g.west) / g.width) * Math.cos((lat * Math.PI) / 180)) / 1000;
}

/**
 * How much to coarsen the grid for motion: pixels of at least `minKm` (so a
 * fast storm's shift between scans fits the search window) and at most
 * `maxSide` px on the longer side (so matching stays quick).
 */
export function motionFactor(g: Grid, minKm = 2, maxSide = 384): number {
  return Math.max(1, Math.ceil(minKm / Math.max(1e-6, kmPerPixel(g))), Math.ceil(Math.max(g.width, g.height) / maxSide));
}

/**
 * The tile zoom whose pixels are at least as fine as the grid's, within the
 * source's zoom range, backed off while that would take more than `maxTiles`.
 */
export function tileZoom(g: Grid, minzoom: number, maxzoom: number, tileSize = 256, maxTiles = 24): number {
  const wanted = Math.ceil(Math.log2((WORLD_M * g.width) / (tileSize * (g.east - g.west))));
  let z = Math.max(minzoom, Math.min(maxzoom, wanted));
  while (z > minzoom && tilesFor(g, z, tileSize).tiles.length > maxTiles) z--;
  return z;
}

/**
 * The tiles covering the grid at zoom `z`, each with its offset in a canvas of
 * `width`×`height` px at that zoom whose top-left is the grid's.
 */
export function tilesFor(g: Grid, z: number, tileSize = 256): { tiles: { z: number; x: number; y: number; px: number; py: number }[]; width: number; height: number } {
  const world = tileSize * 2 ** z;
  const X = (m: number) => ((m + WORLD_M / 2) / WORLD_M) * world;
  const Y = (m: number) => ((WORLD_M / 2 - m) / WORLD_M) * world;
  const left = X(g.west);
  const top = Y(g.north);
  const right = X(g.east);
  const bottom = Y(g.south);
  const n = 2 ** z;
  const tiles: { z: number; x: number; y: number; px: number; py: number }[] = [];
  for (let ty = Math.max(0, Math.floor(top / tileSize)); ty <= Math.min(n - 1, Math.floor((bottom - 1e-6) / tileSize)); ty++)
    for (let tx = Math.floor(left / tileSize); tx <= Math.floor((right - 1e-6) / tileSize); tx++)
      tiles.push({ z, x: ((tx % n) + n) % n, y: ty, px: tx * tileSize - left, py: ty * tileSize - top });
  return { tiles, width: right - left, height: bottom - top };
}

/** An XYZ tile template filled in. */
export const tileUrl = (template: string, t: { z: number; x: number; y: number }) =>
  template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));

/** A WMS GetMap template (`{bbox-epsg-3857}`) as one image of the whole grid. */
export const wmsUrl = (template: string, g: Grid) =>
  template
    .replace("{bbox-epsg-3857}", [g.west, g.south, g.east, g.north].map((v) => v.toFixed(1)).join(","))
    .replace(/([?&])width=\d+/i, `$1width=${g.width}`)
    .replace(/([?&])height=\d+/i, `$1height=${g.height}`);

// ── Worker messages ─────────────────────────────────────────────────────────

/** One scan as the worker fetches it. */
export interface NowcastSource {
  /** XYZ (`{z}/{x}/{y}`) or WMS (`{bbox-epsg-3857}`) template. */
  template: string;
  tileSize: number;
  minzoom: number;
  maxzoom: number;
}

export interface NowcastJob {
  type: "run";
  id: number;
  older: NowcastSource;
  newer: NowcastSource;
  /** Minutes between the two scans. */
  gapMin: number;
  grid: Grid;
  leads: number[];
}

export type NowcastRequest = NowcastJob | { type: "cancel"; id: number };

export type NowcastResponse =
  | { id: number; ok: true; frames: { lead: number; image: Blob }[] }
  /** `skipped`: nothing to extrapolate (too little echo, no clear motion, scans that didn't load). */
  | { id: number; ok: false; skipped: boolean; error?: string };
