/*
 * Simulated weather radar for the Radar School lessons (lesson.html): storms
 * built from simple shapes plus seeded noise, sampled on a grid and painted
 * with the usual NWS colour tables, so a lesson can show a textbook hook
 * echo, velocity couplet or debris signature that never existed. Every image
 * made with it is labelled as a simulated example.
 *
 * Units are kilometres (x east, y south, as on screen) and metres per second.
 * A storm is { ref(x, y), vel(x, y), cc(x, y), points, radar }: each sampler
 * returns NaN where there's nothing to draw; `points` names the features a
 * lesson can point at; `radar` is where the radar sits.
 */
(() => {
  // ── seeded randomness ────────────────────────────────────────────────────
  /** mulberry32: a small, fast seeded generator returning [0, 1). */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(ix, iy, seed) {
    let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  /** Smooth value noise in [0, 1). */
  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  /** Three octaves of noise, about [0, 1). */
  const fbm = (x, y, seed) => noise(x, y, seed) * 0.55 + noise(x * 2.1, y * 2.1, seed + 7) * 0.3 + noise(x * 4.3, y * 4.3, seed + 13) * 0.15;

  // ── shapes ───────────────────────────────────────────────────────────────
  /** An elliptical Gaussian bump: 1 at (cx, cy), sx/sy wide along an axis turned `rot` radians. */
  function blob(x, y, cx, cy, sx, sy, rot = 0) {
    const dx = x - cx, dy = y - cy, c = Math.cos(rot), s = Math.sin(rot);
    const u = (dx * c + dy * s) / sx, v = (-dx * s + dy * c) / sy;
    return Math.exp(-(u * u + v * v));
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  // ── colour tables ────────────────────────────────────────────────────────
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  /** The NWS reflectivity table, 5 dBZ steps. */
  const REF_STEPS = ["#04e9e7", "#019ff4", "#0300f4", "#02fd02", "#01c501", "#008e00", "#fdf802", "#e5bc00", "#fd9500", "#fd0000", "#d40000", "#bc0000", "#f800fd", "#9854c6", "#fdfdfd"].map(hex);
  function refColor(dbz) {
    if (!(dbz >= 5)) return null;
    return REF_STEPS[Math.min(REF_STEPS.length - 1, Math.floor((dbz - 5) / 5))];
  }
  /** Radial velocity: greens toward the radar (negative), reds away, grey near zero, pink past 40 m/s away. */
  function velColor(v) {
    if (!Number.isFinite(v)) return null;
    const a = Math.abs(v);
    if (a < 1.5) return [118, 118, 118];
    const t = clamp((a - 1.5) / 30);
    if (v < 0) return a > 36 ? [170, 255, 200] : [Math.round(lerp(40, 0, t)), Math.round(lerp(95, 255, t)), Math.round(lerp(45, 70, t))];
    return a > 36 ? [255, 150, 205] : [Math.round(lerp(100, 255, t)), Math.round(lerp(40, 30, t)), Math.round(lerp(40, 45, t))];
  }
  const CC_STOPS = [[0.2, [30, 30, 120]], [0.5, [40, 90, 210]], [0.7, [40, 190, 190]], [0.8, [60, 200, 60]], [0.85, [230, 230, 40]], [0.9, [240, 150, 30]], [0.95, [220, 40, 40]], [0.97, [200, 60, 170]], [1.0, [245, 205, 245]]];
  function ccColor(v) {
    if (!(v >= 0.2)) return null;
    for (let i = 1; i < CC_STOPS.length; i++) {
      const [b, cb] = CC_STOPS[i];
      if (v <= b) {
        const [a, ca] = CC_STOPS[i - 1], t = (v - a) / (b - a);
        return [0, 1, 2].map((k) => Math.round(lerp(ca[k], cb[k], t)));
      }
    }
    return CC_STOPS[CC_STOPS.length - 1][1];
  }
  const PRODUCTS = {
    ref: { name: "Reflectivity", unit: "dBZ", color: refColor, ticks: [[5, "5"], [20, "20"], [35, "35"], [50, "50"], [65, "65"], [75, "75+"]], range: [5, 80] },
    vel: { name: "Velocity", unit: "mph", color: velColor, ticks: [[-31, "-70 toward"], [0, "0"], [31, "70 away"]], range: [-36, 36] },
    cc: { name: "Correlation coefficient", unit: "CC", color: ccColor, ticks: [[0.2, "0.2"], [0.5, "0.5"], [0.8, "0.8"], [0.9, "0.9"], [1, "1.0"]], range: [0.2, 1] },
  };

  // ── storms ───────────────────────────────────────────────────────────────
  /**
   * A storm of `kind` with knobs `p`, varied by `seed` (position, size,
   * texture) so no two examples look the same. Knobs (0-1 unless noted):
   *   supercell: hook (how far the hook has wrapped), notch (inflow notch), debris (debris ball + low CC),
   *              rot (rotation strength), drift (km the storm has moved, x and y)
   *   multicell: (none)
   *   bow:       bow (how far the line has bowed out), notch (rear inflow notch)
   *   hail:      spike (three-body scatter spike length)
   */
  function storm(kind, p = {}, seed = 1) {
    const r = rng(seed * 9973 + kind.length);
    const jitter = (amt) => (r() * 2 - 1) * amt;
    const tex = seed * 31 + 5;
    const grain = (x, y) => fbm(x / 3.2, y / 3.2, tex) - 0.5;
    const dx = (p.drift && p.drift[0]) || 0, dy = (p.drift && p.drift[1]) || 0;
    const radar = { x: 20 + jitter(8), y: 118 + jitter(6) };
    let ref, vel, cc, points;

    if (kind === "supercell") {
      const sz = 1 + jitter(0.15);
      const C = { x: 64 + jitter(6) + dx, y: 34 + jitter(5) + dy };
      const M = { x: C.x - 7.5 * sz, y: C.y + 6.5 * sz };
      const hook = clamp(p.hook ?? 1), notch = clamp(p.notch ?? 1), debris = clamp(p.debris ?? 0), rot = clamp(p.rot ?? 1);
      const path = [];
      const N = 28;
      for (let i = 0; i <= N; i++) {
        const s = (i / N) * hook, th = (-80 - s * 215) * (Math.PI / 180), R = 4.8 * sz * (1 - 0.42 * s) * (1 + 0.12 * Math.sin(s * 7 + seed));
        path.push([M.x + R * Math.cos(th), M.y + R * Math.sin(th), s]);
      }
      const tip = { x: path[N][0], y: path[N][1] };
      const notchAt = { x: M.x + 5.2 * sz, y: M.y + 0.4 * sz };
      const ffdDir = -0.62; // the forward flank trails to the northeast
      ref = (x, y) => {
        let f = 62 * blob(x, y, C.x, C.y, 5 * sz, 4 * sz, 0.3);
        f = Math.max(f, 46 * blob(x, y, C.x + 9 * sz, C.y - 6 * sz, 15 * sz, 6.5 * sz, ffdDir));
        f = Math.max(f, 30 * blob(x, y, C.x + 16 * sz, C.y - 10 * sz, 27 * sz, 12 * sz, ffdDir));
        f = Math.max(f, 20 * blob(x, y, C.x + 30 * sz, C.y - 19 * sz, 30 * sz, 9 * sz, ffdDir));
        f *= 1 - 0.8 * notch * blob(x, y, notchAt.x, notchAt.y, 3.4 * sz, 2.6 * sz);
        if (hook > 0.02) {
          let best = Infinity, bs = 0;
          for (const [px, py, s] of path) {
            const d = (x - px) * (x - px) + (y - py) * (y - py);
            if (d < best) [best, bs] = [d, s];
          }
          f = Math.max(f, (52 - 12 * bs) * Math.exp(-best / (1.8 * sz) ** 2));
        }
        if (debris > 0) f = Math.max(f, 66 * debris * blob(x, y, tip.x, tip.y, 1.15, 1.15));
        f += grain(x, y) * (f > 15 ? 9 : 5);
        return f >= 5 ? f : NaN;
      };
      const flow = { u: 9, v: -7 }; // storm-environment wind from the southwest, m/s
      vel = (x, y) => {
        const z = ref(x, y);
        if (!(z >= 8)) return NaN;
        let u = flow.u, v = flow.v;
        const ex = x - M.x, ey = y - M.y, d = Math.hypot(ex, ey) || 1e-6, Rc = 1.7 * sz;
        const vt = 34 * rot * (d < Rc ? d / Rc : Rc / d);
        // Counterclockwise as seen from above (y points south on screen).
        u += vt * (ey / d);
        v += vt * (-ex / d);
        const rx = x - radar.x, ry = y - radar.y, rl = Math.hypot(rx, ry);
        return (u * rx + v * ry) / rl + grain(x, y) * 3;
      };
      cc = (x, y) => {
        const z = ref(x, y);
        if (!(z >= 8)) return NaN;
        let c = z < 20 ? 0.93 + grain(x, y) * 0.08 : 0.985 + grain(x, y) * 0.02;
        c -= 0.05 * blob(x, y, C.x, C.y, 3.5 * sz, 3 * sz); // hail in the core
        if (debris > 0) c -= 0.55 * debris * blob(x, y, tip.x, tip.y, 1.5, 1.5);
        return clamp(c, 0.2, 1);
      };
      points = { core: C, meso: M, hook: path[Math.round(N * 0.55)] ? { x: path[Math.round(N * 0.55)][0], y: path[Math.round(N * 0.55)][1] } : tip, tip, notch: notchAt, ffd: { x: C.x + 12 * sz, y: C.y - 8 * sz }, couplet: M, debris: tip };
    } else if (kind === "multicell") {
      const cells = [];
      const amps = [66, 56, 49, 44, 38, 32];
      for (const a of amps) cells.push({ x: 48 + jitter(26), y: 40 + jitter(16), sx: 3 + r() * 3.5 + (66 - a) * 0.04, sy: 2.5 + r() * 2.5, rot: r() * Math.PI, a });
      const strong = cells[0];
      const light = { x: strong.x - 18 - r() * 6, y: strong.y + 6 + jitter(4) };
      ref = (x, y) => {
        let f = 26 * blob(x, y, light.x, light.y, 17, 9, 0.4) + 6 * (fbm(x / 9, y / 9, tex + 3) - 0.3);
        for (const c of cells) f = Math.max(f, c.a * blob(x, y, c.x, c.y, c.sx, c.sy, c.rot), 0.62 * c.a * blob(x, y, c.x, c.y, c.sx * 2.4, c.sy * 2.2, c.rot));
        f += grain(x, y) * (f > 15 ? 10 : 6);
        return f >= 5 ? f : NaN;
      };
      vel = () => NaN;
      cc = (x, y) => (ref(x, y) >= 8 ? clamp(0.98 + grain(x, y) * 0.03, 0.2, 1) : NaN);
      // The sharpest edge: just upwind of the strongest cell, where colours change fastest.
      points = { core: { x: strong.x, y: strong.y }, light, edge: { x: strong.x + strong.sx * 1.4, y: strong.y }, moderate: { x: cells[2].x, y: cells[2].y } };
    } else if (kind === "bow") {
      const bow = clamp(p.bow ?? 1), rin = clamp(p.notch ?? bow);
      const xc = 52 + jitter(5) + dx, yc = 40 + jitter(5) + dy;
      const lineX = (y) => xc + bow * 15 * Math.exp(-(((y - yc) / 13) ** 2)) - 6 + 2.5 * (noise(y / 6, 1, tex) - 0.5);
      const rinAt = { x: lineX(yc) - 10, y: yc };
      ref = (x, y) => {
        const d = x - lineX(y);
        let f = 0;
        if (d < 2) f = Math.max(f, (52 + 12 * noise(y / 3.5, 2, tex + 9)) * Math.exp(-(((d + 1.2) / 1.7) ** 2)));
        if (d < 0) f = Math.max(f, (33 + 4 * noise(y / 8, x / 8, tex + 4)) * Math.exp(-(((d + 13) / 10) ** 2)));
        f *= 1 - 0.75 * rin * blob(x, y, rinAt.x, rinAt.y, 4.5, 3.2);
        f *= clamp(1.4 - Math.abs(y - yc) / 34);
        f += grain(x, y) * (f > 15 ? 8 : 4);
        return f >= 5 ? f : NaN;
      };
      vel = () => NaN;
      cc = (x, y) => (ref(x, y) >= 8 ? clamp(0.98 + grain(x, y) * 0.03, 0.2, 1) : NaN);
      points = { apex: { x: lineX(yc) + 1, y: yc }, notch: rinAt, north: { x: lineX(yc - 22), y: yc - 22 }, south: { x: lineX(yc + 22), y: yc + 22 } };
    } else if (kind === "hail") {
      const C = { x: 58 + jitter(6) + dx, y: 36 + jitter(5) + dy };
      const spike = clamp(p.spike ?? 1);
      const ux = C.x - radar.x, uy = C.y - radar.y, ul = Math.hypot(ux, uy), ax = ux / ul, ay = uy / ul;
      ref = (x, y) => {
        let f = Math.max(70 * blob(x, y, C.x, C.y, 3.6, 3.0, 0.4), 50 * blob(x, y, C.x + 2, C.y - 1, 9, 6.5, -0.5), 30 * blob(x, y, C.x + 8, C.y - 5, 20, 10, -0.6));
        if (spike > 0) {
          const rx = x - C.x, ry = y - C.y, along = rx * ax + ry * ay, across = Math.abs(-rx * ay + ry * ax);
          const len = 18 * spike;
          if (along > 6 && along < 6 + len && across < 1.1) f = Math.max(f, (24 - (along - 6) * 0.55) * (1 - across / 1.1) + noise(along / 2, 3, tex) * 6);
        }
        f += grain(x, y) * (f > 15 ? 8 : 4);
        return f >= 5 ? f : NaN;
      };
      vel = () => NaN;
      cc = (x, y) => (ref(x, y) >= 8 ? clamp(0.97 - 0.07 * blob(x, y, C.x, C.y, 3.5, 3) + grain(x, y) * 0.03, 0.2, 1) : NaN);
      points = { core: C, spike: { x: C.x + ax * (6 + 9 * spike), y: C.y + ay * (6 + 9 * spike) }, toward: { x: C.x - ax * 14, y: C.y - ay * 14 } };
    } else throw new Error(`Unknown storm kind ${kind}`);
    // Real echoes are ragged, not smooth shapes: bend every shape a few km with low-frequency noise
    // and add fine speckle. Velocity and CC read this `ref` too, so their outlines match.
    const shape = ref, warp = p.warp ?? 1;
    ref = (x, y) => {
      const wx = (fbm(x / 7, y / 7, tex + 51) - 0.5) * 8 * warp, wy = (fbm(x / 7 + 40, y / 7, tex + 77) - 0.5) * 8 * warp;
      let v = shape(x + wx, y + wy);
      if (Number.isNaN(v)) return NaN;
      v += (noise(x * 1.4, y * 1.4, tex + 91) - 0.5) * 6 + (noise(x * 3.1, y * 3.1, tex + 97) - 0.5) * 4;
      return v >= 5 ? v : NaN;
    };
    return { kind, ref, vel, cc, points, radar };
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  const buffers = new Map();
  function buffer(w, h) {
    const key = `${w}x${h}`;
    if (!buffers.has(key)) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      buffers.set(key, { c, g: c.getContext("2d"), img: new ImageData(w, h) });
    }
    return buffers.get(key);
  }

  /**
   * Paints `product` of `s` into view = { x, y, w, h (screen px), x0, y0 (km at the top left), k (px per km) },
   * sampled every `cell` px. `highlight` = [lo, hi] dims everything outside that range (reflectivity).
   */
  function paint(ctx, s, product, view, { cell = 6, highlight = null, alpha = 1 } = {}) {
    const gw = Math.ceil(view.w / cell), gh = Math.ceil(view.h / cell);
    const b = buffer(gw, gh), data = b.img.data, sample = s[product], color = PRODUCTS[product].color;
    for (let j = 0; j < gh; j++) {
      const y = view.y0 + ((j + 0.5) * cell) / view.k;
      for (let i = 0; i < gw; i++) {
        const x = view.x0 + ((i + 0.5) * cell) / view.k;
        const v = sample(x, y), c = color(v), o = (j * gw + i) * 4;
        if (!c) { data[o + 3] = 0; continue; }
        const dim = highlight && !(v >= highlight[0] && v < highlight[1]);
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = dim ? 45 : 255;
      }
    }
    b.g.putImageData(b.img, 0, 0);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(b.c, 0, 0, gw, gh, view.x, view.y, gw * cell, gh * cell);
    ctx.restore();
  }

  /** Screen position of a point in km. */
  const toScreen = (view, pt) => [view.x + (pt.x - view.x0) * view.k, view.y + (pt.y - view.y0) * view.k];

  window.RadarSim = { rng, noise, fbm, storm, paint, toScreen, PRODUCTS, refColor, velColor, ccColor, REF_STEPS };
})();
