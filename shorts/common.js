/*
 * Shared drawing for the Storm Central Shorts: a 1080x1920 canvas, the intro
 * that eases into a header bar, maps (US or world) with a camera, city labels,
 * panels and the end card. Each Short's page (outlook.html, recap.html,
 * weekly.html, tropical.html) builds its scenes on window.SC and defines
 * window.render(t) and window.DUR. render.ts injects window.DATA first.
 *
 * Everything that matters stays above y = 1460: YouTube's buttons and caption
 * cover the bottom of a Short.
 */
(() => {
  const W = 1080, H = 1920;
  const ctx = document.getElementById("c").getContext("2d");
  const D = window.DATA;
  const logo = new Image();
  logo.src = D.logo;

  // ── helpers ────────────────────────────────────────────────────────────
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a)); // 0..1 progress of t through [a, b]
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const lerp = (a, b, x) => a + (b - a) * x;
  /** Fades in over [a, a+0.6] and out over [b-0.5, b]. */
  const window_ = (t, a, b) => easeOut(seg(t, a, a + 0.6)) * (1 - easeOut(seg(t, b - 0.5, b)));
  const C = {
    bg: "#03060d", panel: "#0b1120", line: "rgba(255,255,255,0.10)", ink: "#f2f4f8", ink2: "#a9b1bf", ink3: "#7d8594",
    accent: "#5b9cf6", land: "#111a2c", water: "#070d19", state: "rgba(200,215,240,0.22)",
    tornado: "#ff453a", wind: "#4c8dff", hail: "#30d158",
  };
  const RISK_COLORS = { MARGINAL: "#66A366", SLIGHT: "#FFE066", ENHANCED: "#FFA366", MODERATE: "#E06666", HIGH: "#EE99EE" };
  const FONT = "SC Inter";

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(s, x, y, { size = 40, weight = 600, color = C.ink, align = "left", alpha = 1, spacing = 0 } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `${weight} ${size}px "${FONT}"`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
    if (spacing) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(s, x, y);
    ctx.restore();
  }
  function wrap(s, maxW, font) {
    ctx.font = font;
    const words = s.split(/\s+/), lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  /** The largest size (down to `min`) at which `s` wraps into `maxH`; returns { size, lines }. */
  function fitText(s, maxW, maxH, { max = 46, min = 32, weight = 600, leading = 1.3 } = {}) {
    let size = max, lines = [];
    for (; size >= min; size -= 2) {
      lines = wrap(s, maxW, `${weight} ${size}px "${FONT}"`);
      if (lines.length * size * leading <= maxH) break;
    }
    return { size: Math.max(size, min), lines };
  }
  /** Shrinks one line until it fits `maxW`. */
  function fitSize(s, maxW, size, weight = 700) {
    for (; size > 20; size -= 2) {
      ctx.font = `${weight} ${size}px "${FONT}"`;
      if (ctx.measureText(s).width <= maxW) break;
    }
    return size;
  }

  // ── frame ──────────────────────────────────────────────────────────────
  function background() {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, 600, 50, W / 2, 600, 1200);
    g.addColorStop(0, "#0b1a36"); g.addColorStop(1, C.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  /** A radar sweep behind the intro, gone by 3 s. */
  function introRadar(t) {
    const a = 1 - easeInOut(seg(t, 2.2, 3.0));
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    const cx = W / 2, cy = 720, R = 470;
    for (const r of [150, 300, 450]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = "rgba(56,189,248,0.18)"; ctx.lineWidth = 3; ctx.stroke(); }
    const ang = t * 2.4 - Math.PI / 2;
    const g = ctx.createConicGradient(ang - 0.7, cx, cy);
    g.addColorStop(0, "rgba(56,189,248,0)"); g.addColorStop(0.7 / (2 * Math.PI), "rgba(56,189,248,0.32)"); g.addColorStop(0.7 / (2 * Math.PI) + 0.001, "rgba(56,189,248,0)"); g.addColorStop(1, "rgba(56,189,248,0)");
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.strokeStyle = "rgba(138,216,255,0.8)"; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
  }

  /**
   * The big centred intro (logo, kicker, `lines`, date) that eases into the
   * header bar (logo, `title`, date) at 2.4-3.2 s.
   */
  function header(t, { kicker = "STORM CENTRAL", lines, title, date }) {
    const m = easeInOut(seg(t, 2.4, 3.2));
    const ls = lerp(200, 92, m), lx = lerp(W / 2 - ls / 2, 56, m), ly = lerp(620, 120, m);
    if (logo.complete) { ctx.save(); rr(lx, ly, ls, ls, ls * 0.22); ctx.clip(); ctx.drawImage(logo, lx, ly, ls, ls); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = easeOut(seg(t, 0.2, 0.8));
    if (m < 0.5) {
      const a = 1 - m * 2;
      text(kicker, W / 2, 900, { size: 34, weight: 700, color: C.accent, align: "center", spacing: 6, alpha: a });
      lines.forEach((l, i) => text(l, W / 2, 1010 + i * 102, { size: fitSize(l, W - 120, 96), weight: 700, align: "center", alpha: a }));
      text(date, W / 2, 1010 + lines.length * 102 - 12, { size: 40, weight: 500, color: C.ink2, align: "center", alpha: a });
    } else {
      const a = (m - 0.5) * 2;
      text(title, 172, 160, { size: fitSize(title, W - 172 - 40, 50), weight: 700, alpha: a });
      text(date, 172, 208, { size: 32, weight: 500, color: C.ink2, alpha: a });
    }
    ctx.restore();
  }

  /** The closing card from `t0` (about 6 s): logo, the pitch, the link, and `follow`. */
  function endCard(t, t0, follow) {
    const a = easeOut(seg(t, t0, t0 + 0.8));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a * 0.92; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    const s = 220, x = W / 2 - s / 2, y = 470 + (1 - a) * 30;
    if (logo.complete) { ctx.save(); rr(x, y, s, s, 48); ctx.clip(); ctx.drawImage(logo, x, y, s, s); ctx.restore(); }
    text("Get alerts before", W / 2, y + 340, { size: 76, weight: 700, align: "center" });
    text("the storm arrives", W / 2, y + 426, { size: 76, weight: 700, align: "center" });
    const b = easeOut(seg(t, t0 + 1.3, t0 + 2.0));
    ctx.save(); ctx.globalAlpha = a * b;
    rr(W / 2 - 380, y + 500, 760, 120, 24); ctx.fillStyle = C.accent; ctx.fill();
    text("stormcentralwx.com", W / 2, y + 578, { size: 54, weight: 700, color: "#06101f", align: "center" });
    ctx.restore();
    text("Free on Windows, Android and the web", W / 2, y + 700, { size: 36, weight: 500, color: C.ink2, align: "center", alpha: b });
    text(follow, W / 2, y + 790, { size: 36, weight: 600, color: C.accent, align: "center", alpha: easeOut(seg(t, t0 + 2.4, t0 + 3.0)) });
    ctx.restore();
  }

  // ── maps ───────────────────────────────────────────────────────────────
  const MAP = { x: 40, y: 330, w: 1000, h: 690 };
  const PANEL = { x: 40, y: 1060, w: 1000, h: 400 };
  const mapCenter = [MAP.x + MAP.w / 2, MAP.y + MAP.h / 2];

  const states = D.states ? topojson.feature(D.states, D.states.objects.states).features.filter((f) => !["02", "15", "72", "78", "60", "66", "69"].includes(f.id)) : [];
  const conus = { type: "FeatureCollection", features: states };
  const stateMesh = D.states ? topojson.mesh(D.states, D.states.objects.states, (a, b) => a !== b) : null;
  const world = D.world ? topojson.feature(D.world, D.world.objects.countries) : null;
  const worldMesh = D.world ? topojson.mesh(D.world, D.world.objects.countries, (a, b) => a !== b) : null;

  /** The contiguous US in the map box. */
  const usProjection = () =>
    d3.geoConicConformal().parallels([33, 45]).rotate([96, 0]).fitExtent([[MAP.x + 30, MAP.y + 40], [MAP.x + MAP.w - 30, MAP.y + MAP.h - 40]], conus);

  /**
   * A map: `projection`, then draw(cam, layers, overlay) with cam = { k, c }
   * (zoom factor and the projected point at the box centre).
   */
  function makeMap(projection, { base = "us", source = "Source: NOAA" } = {}) {
    const path = d3.geoPath(projection, ctx);
    const home = { k: 1, c: mapCenter };
    /** The camera that fits `geo` in `frac` of the box, at most `maxK`. */
    function fit(geo, { frac = 0.62, maxK = 2.6 } = {}) {
      const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds(geo);
      if (![x0, y0, x1, y1].every(Number.isFinite)) return home;
      const k = clamp(Math.min((MAP.w * frac) / Math.max(x1 - x0, 1), (MAP.h * frac) / Math.max(y1 - y0, 1)), 1, maxK);
      return { k, c: [(x0 + x1) / 2, (y0 + y1) / 2] };
    }
    const mix = (a, b, z) => ({ k: lerp(a.k, b.k, z), c: [lerp(a.c[0], b.c[0], z), lerp(a.c[1], b.c[1], z)] });
    /** Projected [x, y] on screen under `cam`. */
    function screen(lonlat, cam) {
      const p = projection(lonlat);
      return p ? [(p[0] - cam.c[0]) * cam.k + mapCenter[0], (p[1] - cam.c[1]) * cam.k + mapCenter[1]] : null;
    }
    /**
     * layers: [{ features, alpha, fill(f), stroke(f), featureAlpha?(f), lineWidth? }];
     * overlay(cam): drawn on top, in screen space, clipped to the box.
     */
    function draw(cam, layers = [], overlay) {
      const k = cam.k;
      ctx.save();
      rr(MAP.x, MAP.y, MAP.w, MAP.h, 28); ctx.fillStyle = base === "world" ? C.water : C.panel; ctx.fill();
      ctx.clip();
      ctx.save();
      ctx.translate(mapCenter[0], mapCenter[1]); ctx.scale(k, k); ctx.translate(-cam.c[0], -cam.c[1]);
      if (base === "world" && world) { ctx.beginPath(); path(world); ctx.fillStyle = C.land; ctx.fill(); }
      else { ctx.beginPath(); path(conus); ctx.fillStyle = C.land; ctx.fill(); }
      for (const L of layers) {
        if (!(L.alpha > 0)) continue;
        for (const f of L.features) {
          const a = L.alpha * (L.featureAlpha ? L.featureAlpha(f) : 1);
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          ctx.beginPath(); path(f);
          if (L.fill) { ctx.fillStyle = L.fill(f); ctx.fill(); }
          if (L.stroke) { ctx.lineWidth = (L.lineWidth ?? 2.5) / k; ctx.strokeStyle = L.stroke(f); ctx.setLineDash(L.dash ? L.dash.map((d) => d / k) : []); ctx.stroke(); ctx.setLineDash([]); }
        }
      }
      ctx.globalAlpha = 1;
      if (base === "world" && worldMesh) { ctx.beginPath(); path(worldMesh); ctx.lineWidth = 1.4 / k; ctx.strokeStyle = C.state; ctx.stroke(); }
      if (stateMesh) { ctx.beginPath(); path(stateMesh); ctx.lineWidth = 1.2 / k; ctx.strokeStyle = C.state; ctx.stroke(); }
      if (base !== "world") { ctx.beginPath(); path(conus); ctx.lineWidth = 2 / k; ctx.strokeStyle = "rgba(200,215,240,0.35)"; ctx.stroke(); }
      ctx.restore();
      if (overlay) overlay(cam);
      ctx.restore();
      rr(MAP.x, MAP.y, MAP.w, MAP.h, 28); ctx.lineWidth = 2; ctx.strokeStyle = C.line; ctx.stroke();
      text(source, MAP.x + MAP.w - 24, MAP.y + MAP.h - 22, { size: 22, weight: 500, color: C.ink3, align: "right" });
    }
    /** City labels (fixed size, none overlapping), faded by `alpha`. */
    function cities(cam, alpha, list = CITIES) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha *= clamp(alpha);
      ctx.font = `600 26px "${FONT}"`;
      const placed = [];
      for (const [name, lon, lat] of list) {
        const p = screen([lon, lat], cam);
        if (!p) continue;
        const [x, y] = p;
        const w = ctx.measureText(name).width;
        const box = [x - 8, y - 30, x + w + 18, y + 10];
        if (box[0] < MAP.x + 10 || box[2] > MAP.x + MAP.w - 10 || box[1] < MAP.y + 10 || box[3] > MAP.y + MAP.h - 50) continue;
        if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
        placed.push(box);
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.stroke();
        ctx.lineWidth = 6; ctx.strokeStyle = "rgba(3,6,13,0.85)"; ctx.lineJoin = "round"; ctx.strokeText(name, x + 12, y - 8);
        ctx.fillStyle = "#fff"; ctx.fillText(name, x + 12, y - 8);
      }
      ctx.restore();
    }
    return { projection, home, fit, mix, screen, draw, cities };
  }

  const CITIES = [
    ["Oklahoma City", -97.52, 35.47], ["Dallas", -96.8, 32.78], ["Amarillo", -101.83, 35.22], ["Lubbock", -101.86, 33.58], ["Tulsa", -95.99, 36.15],
    ["Wichita Falls", -98.49, 33.91], ["Little Rock", -92.29, 34.75], ["Wichita", -97.34, 37.69], ["Kansas City", -94.58, 39.1], ["San Antonio", -98.49, 29.42],
    ["Austin", -97.74, 30.27], ["Houston", -95.37, 29.76], ["Midland", -102.08, 31.99], ["Abilene", -99.73, 32.45], ["Shreveport", -93.75, 32.53],
    ["Memphis", -90.05, 35.15], ["St. Louis", -90.2, 38.63], ["Denver", -104.99, 39.74], ["Albuquerque", -106.65, 35.08], ["El Paso", -106.49, 31.76],
    ["Omaha", -95.94, 41.26], ["Nashville", -86.78, 36.16], ["Louisville", -85.76, 38.25], ["Cincinnati", -84.51, 39.1], ["Columbus", -83.0, 39.96],
    ["Pittsburgh", -79.99, 40.44], ["Washington", -77.04, 38.91], ["Chicago", -87.63, 41.88], ["Indianapolis", -86.16, 39.77], ["Jackson", -90.18, 32.3],
    ["New Orleans", -90.07, 29.95], ["Birmingham", -86.8, 33.52], ["Atlanta", -84.39, 33.75], ["Minneapolis", -93.27, 44.98], ["Detroit", -83.05, 42.33],
    ["Charlotte", -80.84, 35.23], ["Philadelphia", -75.17, 39.95], ["New York", -74.01, 40.71], ["Phoenix", -112.07, 33.45], ["Salt Lake City", -111.89, 40.76],
    ["Des Moines", -93.61, 41.59], ["Sioux Falls", -96.73, 43.55], ["Fargo", -96.79, 46.88], ["Billings", -108.5, 45.78], ["Milwaukee", -87.91, 43.04],
    ["Jacksonville", -81.66, 30.33], ["Tampa", -82.46, 27.95], ["Miami", -80.19, 25.76], ["Raleigh", -78.64, 35.78], ["Boston", -71.06, 42.36],
  ];
  /** Places around the Gulf, the Caribbean and the Atlantic, for hurricane maps. */
  const TROPICAL_CITIES = [
    ["Miami", -80.19, 25.76], ["Tampa", -82.46, 27.95], ["New Orleans", -90.07, 29.95], ["Houston", -95.37, 29.76], ["Corpus Christi", -97.4, 27.8],
    ["Jacksonville", -81.66, 30.33], ["Charleston", -79.93, 32.78], ["Wilmington", -77.94, 34.23], ["Norfolk", -76.29, 36.85], ["New York", -74.01, 40.71],
    ["Havana", -82.37, 23.11], ["Nassau", -77.35, 25.06], ["Kingston", -76.79, 17.97], ["Santo Domingo", -69.93, 18.49], ["San Juan", -66.11, 18.47],
    ["Cancún", -86.85, 21.16], ["Veracruz", -96.13, 19.17], ["Bermuda", -64.78, 32.3], ["Tallahassee", -84.28, 30.44], ["Mobile", -88.04, 30.69],
    ["Acapulco", -99.88, 16.85], ["Cabo San Lucas", -109.92, 22.89], ["Mazatlán", -106.41, 23.25], ["Honolulu", -157.86, 21.31], ["Guadeloupe", -61.55, 16.25],
  ];

  window.SC = {
    W, H, ctx, D, logo, C, RISK_COLORS, MAP, PANEL, mapCenter, CITIES, TROPICAL_CITIES,
    clamp, seg, easeOut, easeInOut, lerp, fade: window_, rr, text, wrap, fitText, fitSize,
    background, introRadar, header, endCard, makeMap, usProjection, conus,
  };
})();
