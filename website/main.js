/*
 * Storm Central website: smooth scrolling (Lenis), the hero radar, scroll-driven
 * effects (window tilt, sticky tour, reveals, notifications, counters), the
 * trailer, and download links filled in from the latest GitHub release.
 * Everything degrades to a plain, readable page without JavaScript or with
 * reduced motion.
 */
(() => {
  "use strict";

  const REPO = "KingCreeper531/StormCentral";
  const STORE = "https://apps.microsoft.com/detail/9P3SXT2T0CLQ";
  const WEB_APP = "https://storm-central-pi.vercel.app/";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const desktop = matchMedia("(min-width: 960px)");

  // ── Smooth scrolling ───────────────────────────────────────────────────

  let lenis = null;
  if (!reduceMotion && typeof window.Lenis === "function") {
    lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 1, autoRaf: true });
  }

  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute("href");
    const target = id === "#top" ? document.body : $(id);
    if (!target) return;
    e.preventDefault();
    const offset = id === "#top" ? 0 : -64;
    if (lenis) lenis.scrollTo(id === "#top" ? 0 : target, { offset, duration: 1.4 });
    else window.scrollTo({ top: id === "#top" ? 0 : target.getBoundingClientRect().top + scrollY + offset, behavior: reduceMotion ? "auto" : "smooth" });
    history.replaceState(null, "", id === "#top" ? location.pathname : id);
    if (id !== "#top") {
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  });

  // ── Scroll-driven effects ──────────────────────────────────────────────

  const nav = $("#nav");
  const progress = $(".progress span");
  const heroInner = $("#hero-inner");
  const radarCanvas = $("#radar");
  const showcase = $("#showcase-window");
  const steps = $$(".step");
  const shots = $$("#tour-window [data-shot]");
  const dots = $$(".tour-dots li");
  const caption = $("#tour-caption");
  const navLinks = $$(".nav-links a");
  const sections = navLinks.map((a) => $(a.getAttribute("href")));
  let activeStep = 0;
  let queued = false;

  function setStep(i) {
    if (i === activeStep) return;
    activeStep = i;
    steps.forEach((s, n) => s.classList.toggle("is-active", n === i));
    shots.forEach((s, n) => s.classList.toggle("on", n === i));
    dots.forEach((d, n) => d.classList.toggle("on", n === i));
    if (caption) caption.textContent = dots[i]?.textContent ?? "";
  }
  steps[0]?.classList.add("is-active");

  function update() {
    queued = false;
    const y = scrollY;
    const vh = innerHeight;
    const max = document.documentElement.scrollHeight - vh;

    progress?.style.setProperty("--scroll", max > 0 ? (y / max).toFixed(4) : "0");
    nav?.classList.toggle("scrolled", y > 8);

    if (!reduceMotion) {
      // Hero: the text drifts up and fades; the radar eases in behind it.
      if (y < vh * 1.2 && heroInner) {
        heroInner.style.transform = `translate3d(0, ${(y * 0.32).toFixed(1)}px, 0)`;
        heroInner.style.opacity = clamp(1 - y / (vh * 0.65), 0, 1).toFixed(3);
        radarCanvas.style.transform = `scale(${(1 + (y / vh) * 0.18).toFixed(4)})`;
      }
      // Showcase window: tilted back until its top is well into view.
      if (showcase) {
        const top = showcase.getBoundingClientRect().top;
        showcase.style.setProperty("--p", clamp((vh - top) / (vh * 0.75), 0, 1).toFixed(4));
      }
    }

    // Tour: the step nearest the middle of the screen drives the sticky window.
    if (desktop.matches && steps.length) {
      const mid = vh / 2;
      let best = 0;
      let bestDist = Infinity;
      steps.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setStep(best);
    }

    // Nav: mark the section being read.
    let current = -1;
    sections.forEach((s, i) => {
      if (s && s.getBoundingClientRect().top < vh * 0.4) current = i;
    });
    navLinks.forEach((a, i) => a.classList.toggle("on", i === current));
  }

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  desktop.addEventListener?.("change", schedule);
  update();

  // ── Reveals, notifications and counters ────────────────────────────────

  // Stagger siblings: each .reveal gets its index among the .reveal children of its parent.
  const groups = new Map();
  $$(".reveal").forEach((el) => {
    const n = groups.get(el.parentElement) ?? 0;
    groups.set(el.parentElement, n + 1);
    el.style.setProperty("--i", String(Math.min(n, 6)));
  });

  // Oldest notification first, so the newest lands on top last.
  const notes = $$("#notes .note");
  notes.forEach((n, i) => n.style.setProperty("--d", `${(notes.length - 1 - i) * 650 + 250}ms`));

  function countUp(el) {
    const to = Number(el.dataset.count);
    if (!to || reduceMotion) return;
    const start = performance.now();
    const dur = 1200;
    const tick = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(tick);
    };
    el.textContent = "0";
    requestAnimationFrame(tick);
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          $$("[data-count]", e.target).forEach(countUp);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    $$(".reveal").forEach((el) => io.observe(el));
  } else {
    $$(".reveal").forEach((el) => el.classList.add("in"));
  }

  // ── Trailer ────────────────────────────────────────────────────────────

  const video = $("#trailer-video");
  const videoBox = $("#video");
  const play = $("#video-play");
  if (video && play) {
    play.addEventListener("click", () => {
      video.controls = true;
      video.play().catch(() => {});
    });
    video.addEventListener("play", () => videoBox.classList.add("playing"));
    video.addEventListener("pause", () => videoBox.classList.remove("playing"));
    video.addEventListener("ended", () => videoBox.classList.remove("playing"));
    // Pause when scrolled away.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => !e.isIntersecting && !video.paused && video.pause(), { threshold: 0.2 }).observe(video);
    }
  }

  // ── Platform and downloads ─────────────────────────────────────────────

  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "android"
    : /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "ios"
      : /Windows NT/i.test(ua)
        ? "windows"
        : "other";

  const icons = {
    windows:
      '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.1 10.4 4v7.1H3zm8.3-1.2L21 2.5v8.6h-9.7zM3 12.9h7.4V20L3 18.9zm8.3 0H21v8.6l-9.7-1.4z"/></svg>',
    external: $("[data-platform=web] .btn-icon")?.innerHTML ?? "",
    arrow: $("#hero-secondary .btn-icon")?.innerHTML ?? "",
  };
  const heroPrimary = $("#hero-primary");
  const heroPrimaryLabel = $("#hero-primary-label");
  const heroPrimaryIcon = $("#hero-primary-icon");
  const heroSecondary = $("#hero-secondary");

  function setHero(href, label, icon) {
    heroPrimary.href = href;
    heroPrimaryLabel.textContent = label;
    if (icon) heroPrimaryIcon.innerHTML = icon;
  }
  function setSecondary(href, label) {
    heroSecondary.href = href;
    heroSecondary.firstElementChild.textContent = label;
  }

  if (os === "windows") {
    setHero(STORE, "Get it from Microsoft Store", icons.windows);
    setSecondary("#download", "Other downloads");
  } else if (os === "android") {
    setHero("#download", "Download for Android");
    setSecondary("#download", "Other downloads");
  } else {
    setHero(WEB_APP, "Open the web app", icons.external);
    setSecondary("#download", "Windows and Android downloads");
  }
  $(`.dl[data-platform="${os === "windows" || os === "android" ? os : "web"}"]`)?.classList.add("is-you");

  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;

  function applyRelease(rel) {
    const version = String(rel.tag_name || "").replace(/^v/, "");
    const exe = rel.assets?.find((a) => /^StormCentral-Setup-.*\.exe$/.test(a.name));
    const apk = rel.assets?.find((a) => /^StormCentral-[\d.]+\.apk$/.test(a.name));
    if (exe) {
      $("#dl-exe").href = exe.browser_download_url;
      $("#dl-exe-size").textContent = `(${mb(exe.size)})`;
    }
    if (apk) {
      $("#dl-apk").href = apk.browser_download_url;
      $("#dl-apk-size").textContent = `(${mb(apk.size)})`;
      if (os === "android") setHero(apk.browser_download_url, "Download for Android");
      if (os !== "android" && os !== "ios") drawQr(apk.browser_download_url);
    }
    if (version) {
      $("#dl-version").textContent = `Latest version: ${version}.`;
      $("#hero-meta").textContent = `Version ${version} for Windows 10 and 11, Android 7 and newer, and any modern browser.`;
    }
  }

  function drawQr(url) {
    const canvas = $("#qr");
    if (!canvas || typeof window.qrcode !== "function") return;
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const ctx = canvas.getContext("2d");
    const cell = Math.floor(canvas.width / n);
    const off = Math.floor((canvas.width - cell * n) / 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
    $("#dl-qr").hidden = false;
  }

  (async () => {
    const KEY = "sc-release";
    try {
      const cached = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (cached && Date.now() - cached.at < 10 * 60_000) return applyRelease(cached.rel);
    } catch {
      // Storage can be unavailable (private mode); fetch instead.
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      const rel = await res.json();
      applyRelease(rel);
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rel: { tag_name: rel.tag_name, assets: rel.assets?.map(({ name, size, browser_download_url }) => ({ name, size, browser_download_url })) } }));
      } catch {
        // Not cached; fine.
      }
    } catch {
      // Offline or rate-limited: the links still go to the Releases page.
    }
  })();

  // ── Hero radar ─────────────────────────────────────────────────────────
  //
  // A procedural storm field (a squall line, a few supercells, trailing
  // rain) revealed by a rotating sweep, with the persistence fade of a real
  // radar scope. Two draws per frame plus the sweep; paused off screen.

  const ctx = radarCanvas?.getContext("2d");
  if (!ctx) return;

  // NWS reflectivity colours, light rain up; capped below the purple of extreme cores.
  const SCALE = [
    [16, [1, 120, 40]],
    [21, [2, 200, 2]],
    [27, [1, 160, 1]],
    [33, [0, 120, 0]],
    [38, [253, 248, 2]],
    [43, [229, 188, 0]],
    [48, [253, 149, 0]],
    [52, [253, 0, 0]],
    [57, [212, 0, 0]],
    [61, [188, 0, 0]],
  ];

  // Seeded value noise, so the storm looks the same on every visit.
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  function fbm(x, y) {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < 5; o++) {
      v += amp * noise(x * f, y * f);
      amp *= 0.5;
      f *= 2.03;
    }
    return v;
  }

  let W = 0;
  let H = 0;
  let dpr = 1;
  let field = null; // the storm, pre-rendered
  let scope = null; // rings and crosshair, pre-rendered

  function buildField() {
    const fw = Math.ceil(W / 2);
    const fh = Math.ceil(H / 2);
    const off = document.createElement("canvas");
    off.width = fw;
    off.height = fh;
    const g = off.getContext("2d");
    const img = g.createImageData(fw, fh);
    const aspect = fw / fh;
    // Supercells ahead of the line: [x, y, radius, peak], in screen fractions.
    const cells = [
      [0.66, 0.34, 0.03, 1.0],
      [0.76, 0.25, 0.024, 0.9],
      [0.55, 0.45, 0.026, 0.88],
      [0.3, 0.72, 0.026, 0.82],
    ];
    for (let py = 0; py < fh; py++) {
      for (let px = 0; px < fw; px++) {
        const x = px / fw;
        const v = py / fh;
        const u = x * aspect;
        const n = fbm(u * 3.6 + 11, v * 3.6 + 7);
        const n2 = fbm(u * 10 + 3, v * 10 + 19);
        const grain = noise(u * 70, v * 70) - 0.5;
        // A squall line from lower left to upper right: sharp leading (south-east) edge, cells along it.
        const lineV = 0.97 - 0.8 * x + 0.05 * Math.sin(x * 9 + 1) + (n - 0.5) * 0.08;
        const d = v - lineV;
        const across = d > 0 ? d / 0.018 : -d / 0.05;
        const line = Math.exp(-across * across) * Math.pow(n2, 1.4) * 1.55;
        // Trailing stratiform rain behind (north-west of) the line.
        const behind = d < 0 ? Math.exp(d / 0.17) * Math.max(0, n - 0.3) * 1.1 : 0;
        let cell = 0;
        for (const [cx, cy, r, peak] of cells) {
          const dx = (x - cx) * aspect * 0.8 + (n2 - 0.5) * 0.03;
          const dy = v - cy + (n - 0.5) * 0.03;
          cell = Math.max(cell, peak * Math.exp(-(dx * dx * 0.6 + dy * dy) / (r * r)));
        }
        // Scattered showers elsewhere.
        const showers = Math.max(0, n2 - 0.6) * 1.3 * Math.max(0, n - 0.45) * 3;
        const intensity = Math.max(line, behind, cell, showers);
        const dbz = Math.min(64, intensity * 68 + grain * 7);
        if (dbz < 16) continue;
        let col = SCALE[0][1];
        for (const [t, c] of SCALE) if (dbz >= t) col = c;
        const i = (py * fw + px) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = Math.round(clamp((dbz - 10) / 22, 0.3, 1) * 215);
      }
    }
    g.putImageData(img, 0, 0);
    field = off;
  }

  function buildScope() {
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const g = off.getContext("2d");
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.hypot(W, H) / 2;
    g.strokeStyle = "rgba(168, 172, 179, 0.09)";
    g.lineWidth = dpr;
    const step = Math.max(110, Math.min(W, H) / 5) * 1;
    for (let r = step; r < R; r += step) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();
    scope = off;
  }

  function resize() {
    const rect = radarCanvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, rect.width > 1400 ? 1.25 : 1.5);
    W = Math.max(1, Math.round(rect.width * dpr));
    H = Math.max(1, Math.round(rect.height * dpr));
    radarCanvas.width = W;
    radarCanvas.height = H;
    buildField();
    buildScope();
  }

  const PERIOD = 7000; // ms per revolution
  const hasConic = typeof ctx.createConicGradient === "function";

  function frame(now) {
    const cx = W / 2;
    const cy = H / 2;
    const a = ((now % PERIOD) / PERIOD) * Math.PI * 2 - Math.PI / 2;
    const drift = Math.sin(now / 45000) * 30 * dpr;

    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(field, drift - 30 * dpr, -drift * 0.5 - 15 * dpr, W + 60 * dpr, H + 30 * dpr);

    if (hasConic) {
      // Persistence: just swept is brightest, about to be swept is darkest.
      const fade = ctx.createConicGradient(a, cx, cy);
      fade.addColorStop(0, "rgba(0,0,0,0.9)");
      fade.addColorStop(0.55, "rgba(0,0,0,0.62)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, W, H);

      const wedge = ctx.createConicGradient(a - 0.5, cx, cy);
      const span = 0.5 / (Math.PI * 2);
      wedge.addColorStop(0, "rgba(91,156,246,0)");
      wedge.addColorStop(span, "rgba(91,156,246,0.13)");
      wedge.addColorStop(span + 0.0001, "rgba(91,156,246,0)");
      wedge.addColorStop(1, "rgba(91,156,246,0)");
      ctx.fillStyle = wedge;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.drawImage(scope, 0, 0);

    const R = Math.hypot(W, H) / 2;
    ctx.strokeStyle = "rgba(91,156,246,0.55)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();

    ctx.fillStyle = "#5b9cf6";
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  let running = false;
  let visible = true;
  function loop(now) {
    if (!running) return;
    frame(now);
    requestAnimationFrame(loop);
  }
  function setRunning() {
    const should = visible && !document.hidden && !reduceMotion;
    if (should && !running) {
      running = true;
      requestAnimationFrame(loop);
    }
    if (!should) running = false;
  }

  resize();
  frame(reduceMotion ? 2600 : performance.now());

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (!running) frame(reduceMotion ? 2600 : performance.now());
    }, 150);
  });
  document.addEventListener("visibilitychange", setRunning);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      setRunning();
    }).observe(radarCanvas);
  }
  setRunning();
})();
