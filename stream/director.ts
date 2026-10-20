/**
 * The 24/7 live stream's director (stream/run.sh starts it on the VPS). It
 * drives the Storm Central web app in a real Chromium window on the virtual
 * screen that ffmpeg sends to YouTube Live:
 *
 * - every minute it reads the NWS's active warnings; scenes cycle through the
 *   national radar, the most serious warnings and Professional mode (plan.ts);
 * - a new tornado warning, emergency or destructive storm cuts in: a chime,
 *   a banner, and the warning read aloud in fixed sentences;
 * - every 20 minutes or so, a short briefing: the warning counts and SPC's
 *   outlook, reworded by the local AI (Ollama) when it's on and its version
 *   passes the fact check, read as written otherwise.
 *
 * The next scene loads in a second tab and swaps in when it's ready, so the
 * stream never shows a page loading. Speech goes to the PulseAudio sink
 * "stream", which ffmpeg records. Anything going badly wrong ends the process;
 * systemd starts the whole stream again.
 *
 *   node director.mjs      (env: see CONFIG below; stream.env on the VPS)
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { RawAlertFeature } from "../src/lib/alerts";
import { regionOf } from "../shorts/meta";
import { parseOutlook } from "../shorts/spc-outlook";
import { activeWarnings, announcement, briefingFacts, briefingPrompt, checkBriefing, cycle, sceneTitle, ticker, worthAnnouncing, type Outlook, type Scene, type StreamWarning } from "./plan";

const run = promisify(execFile);
const env = process.env;
const CONFIG = {
  app: (env.STREAM_APP_URL || "https://storm-central-pi.vercel.app").replace(/\/$/, ""),
  width: Number(env.STREAM_WIDTH) || 1280,
  height: Number(env.STREAM_HEIGHT) || 720,
  voice: env.STREAM_VOICE || "en-US-AndrewNeural",
  sink: env.STREAM_SINK || "stream",
  tmp: env.STREAM_TMP || "/tmp/stormcentral-stream",
  ollama: env.OLLAMA_MODEL ? { host: env.OLLAMA_HOST || "http://127.0.0.1:11434", model: env.OLLAMA_MODEL } : null,
  briefingMinutes: Number(env.STREAM_BRIEFING_MINUTES) || 20,
  heartbeat: env.STREAM_HEARTBEAT || "",
};
const UA = "StormCentralLive/1.0 (github.com/KingCreeper531/StormCentral)";
const NWS = "https://api.weather.gov";
const EVENTS = "Tornado Warning,Severe Thunderstorm Warning,Flash Flood Warning,Extreme Wind Warning";
const HOME = { lat: 35.47, lon: -97.52, name: "Oklahoma City" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── Data ──────────────────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function fetchWarnings(): Promise<StreamWarning[]> {
  const fc = await getJson<{ features?: RawAlertFeature[] }>(`${NWS}/alerts/active?status=actual&event=${encodeURIComponent(EVENTS)}`);
  return activeWarnings(fc.features ?? []);
}

async function fetchOutlook(): Promise<Outlook | null> {
  const list = await getJson<{ "@graph"?: { id: string }[] }>(`${NWS}/products/types/SWO/locations/DY1`);
  const id = list["@graph"]?.[0]?.id;
  if (!id) return null;
  const p = await getJson<{ productText: string }>(`${NWS}/products/${id}`);
  const o = parseOutlook(p.productText);
  return o ? { risk: o.risk ?? null, region: regionOf(p.productText) } : null;
}

/** Tests only: the top warning of a saved NWS scenario (STREAM_DEMO_FIXTURE, STREAM_DEMO_NOW), ending 30 minutes from now. */
function demoWarning(): StreamWarning | null {
  if (!env.STREAM_DEMO_FIXTURE || !env.STREAM_DEMO_NOW) return null;
  const fc = JSON.parse(readFileSync(env.STREAM_DEMO_FIXTURE, "utf8")) as { features?: RawAlertFeature[] };
  const w = activeWarnings(fc.features ?? [], Date.parse(env.STREAM_DEMO_NOW))[0];
  return w ? { ...w, key: `demo-${w.key}`, ends: new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.\d+Z$/, "Z") } : null;
}

// ── Voice ─────────────────────────────────────────────────────────────────

let speaking: Promise<void> = Promise.resolve();
let chime = "";

async function makeChime() {
  mkdirSync(CONFIG.tmp, { recursive: true });
  chime = join(CONFIG.tmp, "chime.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=0.18", "-f", "lavfi", "-i", "sine=frequency=1175:duration=0.3", "-filter_complex", "[0][1]concat=n=2:v=0:a=1,volume=0.35", chime]);
}

/** Reads `text` aloud on the stream (one at a time, in order), with the chime first for alerts. */
function say(text: string, { alert = false } = {}): Promise<void> {
  speaking = speaking.then(async () => {
    try {
      const mp3 = join(CONFIG.tmp, "say.mp3"), wav = join(CONFIG.tmp, "say.wav");
      await run("edge-tts", ["--voice", CONFIG.voice, "--text", text, "--write-media", mp3], { timeout: 60_000 });
      await run("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-ar", "44100", "-ac", "2", wav]);
      if (alert && chime) await run("paplay", [`--device=${CONFIG.sink}`, chime]);
      await run("paplay", [`--device=${CONFIG.sink}`, wav], { timeout: 120_000 });
    } catch (err) {
      log(`couldn't speak: ${err instanceof Error ? err.message : err}`);
    }
  });
  return speaking;
}

async function aiBriefing(facts: string): Promise<string> {
  if (!CONFIG.ollama) return facts;
  try {
    const res = await fetch(`${CONFIG.ollama.host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: CONFIG.ollama.model, prompt: briefingPrompt(facts), stream: false, options: { temperature: 0.6, num_predict: 120 } }),
      signal: AbortSignal.timeout(120_000),
    });
    const { response } = (await res.json()) as { response?: string };
    const ok = checkBriefing(response ?? "", facts);
    if (!ok) log(`AI briefing failed the check, reading the facts: ${JSON.stringify(response)}`);
    return ok ?? facts;
  } catch (err) {
    log(`AI briefing unavailable: ${err instanceof Error ? err.message : err}`);
    return facts;
  }
}

// ── The overlay (drawn into the app's page) ─────────────────────────────

interface OverlayState {
  title: string;
  color: string;
  ticker: string;
  banner: { title: string; places: string; color: string } | null;
}

/** Runs in the page: the LIVE badge, lower third, ticker and banner, created once and updated. */
function drawOverlay(s: OverlayState) {
  const d = document;
  let root = d.getElementById("scl-live");
  if (!root) {
    const css = d.createElement("style");
    css.textContent = `
      #scl-live{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Inter,"SC Inter",system-ui,sans-serif;color:#f2f4f8}
      #scl-live .bar{position:absolute;left:0;right:0;bottom:30px;height:48px;display:flex;align-items:center;gap:14px;padding:0 16px;background:rgba(3,6,13,.94);border-top:3px solid var(--c,#5b9cf6)}
      #scl-live .live{background:#e11d2e;color:#fff;font-weight:800;font-size:15px;letter-spacing:2px;padding:4px 10px;border-radius:4px}
      #scl-live .brand{font-weight:800;font-size:15px;letter-spacing:1px;color:#a9b1bf}
      #scl-live .title{flex:1;font-weight:700;font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #scl-live .clock{font-weight:700;font-size:17px;font-variant-numeric:tabular-nums;color:#a9b1bf}
      #scl-live .tick{position:absolute;left:0;right:0;bottom:0;height:30px;overflow:hidden;background:#0b1120;border-top:1px solid rgba(255,255,255,.08)}
      #scl-live .tick span{position:absolute;white-space:nowrap;line-height:30px;font-size:15px;font-weight:600;padding-left:100%;animation:scl-tick var(--d,60s) linear infinite}
      @keyframes scl-tick{to{transform:translateX(-100%)}}
      #scl-live .banner{position:absolute;left:50%;top:84px;transform:translateX(-50%);min-width:560px;max-width:1100px;padding:14px 26px;border-radius:10px;background:var(--b,#e11d2e);color:#fff;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.5);animation:scl-flash 1s ease-in-out infinite alternate}
      #scl-live .banner b{display:block;font-size:30px;font-weight:900;letter-spacing:1px}
      #scl-live .banner i{display:block;font-style:normal;font-size:19px;font-weight:600;margin-top:4px}
      @keyframes scl-flash{from{filter:brightness(1)}to{filter:brightness(1.25)}}`;
    d.head.appendChild(css);
    root = d.createElement("div");
    root.id = "scl-live";
    root.innerHTML = `<div class="bar"><span class="live">LIVE</span><span class="brand">STORM CENTRAL</span><span class="title"></span><span class="clock"></span></div><div class="tick"><span></span></div><div class="banner" hidden><b></b><i></i></div>`;
    d.body.appendChild(root);
    const clock = root.querySelector(".clock")!;
    const tickClock = () => (clock.textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }));
    tickClock();
    setInterval(tickClock, 10_000);
  }
  root.style.setProperty("--c", s.color);
  root.querySelector(".title")!.textContent = s.title;
  const t = root.querySelector<HTMLElement>(".tick span")!;
  if (t.textContent !== s.ticker) {
    t.textContent = s.ticker;
    t.style.setProperty("--d", `${Math.max(30, Math.round(s.ticker.length / 9))}s`);
  }
  const b = root.querySelector<HTMLElement>(".banner")!;
  b.hidden = !s.banner;
  if (s.banner) {
    b.style.setProperty("--b", s.banner.color);
    b.querySelector("b")!.textContent = s.banner.title;
    b.querySelector("i")!.textContent = s.banner.places;
  }
}

// ── Scenes ────────────────────────────────────────────────────────────────

const urlFor = (s: Scene) => {
  const at = s.kind === "national" ? { lat: 38.5, lon: -96.5, name: "United States" } : s.warning ? { lat: s.warning.lat, lon: s.warning.lon, name: s.warning.areas[0]?.name ?? "Warning" } : HOME;
  const mode = s.kind === "pro" ? "professional" : "severe";
  return `${CONFIG.app}/?mode=${mode}&lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&name=${encodeURIComponent(at.name)}`;
};

class Director {
  private front!: Page;
  private back!: Page;
  private warnings: StreamWarning[] = [];
  private seen = new Set<string>();
  private outlook: Outlook | null = null;
  private interrupt: (() => void) | null = null;
  private pending: StreamWarning[] = [];
  private overlay: OverlayState = { title: "", color: "#5b9cf6", ticker: "", banner: null };
  // The first briefing comes two minutes in, so someone tuning in soon after a restart hears one.
  private lastBriefing = Date.now() - (CONFIG.briefingMinutes - 2) * 60_000;
  private alerting = false;
  closed = false;

  constructor(private context: BrowserContext) {}

  async start() {
    this.front = this.context.pages()[0] ?? (await this.context.newPage());
    this.back = await this.context.newPage();
    await this.refresh(true);
    // Tests: read the most serious warning in effect as if it had just been issued (or, with none, one
    // from a saved scenario, STREAM_DEMO_FIXTURE, moved to now).
    if (env.STREAM_DEMO_ALERT === "1") {
      const demo = this.warnings[0] ?? demoWarning();
      if (demo) this.pending.push(demo);
    }
    void this.watch();
    for (;;) {
      for (const scene of cycle(this.warnings)) {
        const urgent = this.pending.shift();
        if (urgent) await this.alertScene(urgent);
        await this.show(scene);
        await this.hold(scene.seconds * 1000);
      }
    }
  }

  /** Reads the warnings (and now and then the outlook); new ones worth it go to the front of the queue. */
  private async refresh(first = false) {
    try {
      const ws = await fetchWarnings();
      const fresh = ws.filter((w) => !this.seen.has(w.key));
      for (const w of ws) this.seen.add(w.key);
      this.warnings = ws;
      // Warnings already out when the stream starts aren't news; only ones issued while it runs.
      if (!first) {
        const urgent = fresh.filter(worthAnnouncing);
        if (urgent.length) {
          this.pending.push(...urgent);
          this.pending = this.pending.sort((a, b) => b.rank - a.rank).slice(0, 4);
          this.interrupt?.();
        }
      }
      this.overlay.ticker = `Not an official warning source: follow the National Weather Service.   •   ${ticker(ws)}`;
      await this.paint();
    } catch (err) {
      log(`warnings: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async watch() {
    let n = 0;
    for (;;) {
      await sleep(60_000);
      await this.refresh();
      await this.maybeBrief();
      if (n++ % 30 === 0) this.outlook = await fetchOutlook().catch(() => this.outlook);
      if (CONFIG.heartbeat) writeFileSync(CONFIG.heartbeat, new Date().toISOString());
    }
  }

  /** Waits `ms`, or less when a new warning comes in. */
  private hold(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.interrupt = done;
    }).finally(() => (this.interrupt = null));
  }

  private async paint() {
    await this.front?.evaluate(drawOverlay, this.overlay).catch(() => {});
  }

  /** Loads the scene in the back tab, then swaps it to the front. */
  private async show(scene: Scene, banner: OverlayState["banner"] = null) {
    const page = this.back;
    try {
      await page.goto(urlFor(scene), { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(scene.kind === "pro" ? 9_000 : 6_000);
      // The side panel (warnings list, tools) would cover part of the map; the overlay shows what matters.
      await page
        .getByRole("button", { name: "Hide panel" })
        .first()
        .click({ timeout: 3_000 })
        .catch(() => {});
      if (scene.kind === "national") {
        // The whole country: zoom out from the app's local view.
        await page.mouse.move(CONFIG.width / 2, CONFIG.height / 2);
        for (let i = 0; i < 4; i++) {
          await page.mouse.wheel(0, 360);
          await page.waitForTimeout(250);
        }
      }
      this.overlay = {
        ...this.overlay,
        title: scene.kind === "national" ? "National radar" : scene.warning ? sceneTitle(scene.warning) : `Professional mode · ${HOME.name}`,
        color: scene.kind !== "national" && scene.warning ? scene.warning.color : "#5b9cf6",
        banner,
      };
      await page.evaluate(drawOverlay, this.overlay);
      await page.bringToFront();
      [this.front, this.back] = [page, this.front];
      log(`scene: ${this.overlay.title}`);
    } catch (err) {
      log(`scene failed (${urlFor(scene)}): ${err instanceof Error ? err.message : err}`);
      if (page.isClosed() || this.closed) throw err;
    }
  }

  private async alertScene(w: StreamWarning) {
    log(`NEW: ${w.name} (${w.key})`);
    this.alerting = true;
    await this.show({ kind: "warning", warning: w, seconds: 40 }, { title: `NEW ${w.name.toUpperCase()}`, places: sceneTitle(w).split(" · ").slice(1).join(" · "), color: w.color });
    const spoken = say(announcement(w), { alert: true });
    await Promise.race([spoken, sleep(40_000)]);
    await sleep(8_000);
    this.overlay.banner = null;
    await this.paint();
    this.lastBriefing = Date.now();
    this.alerting = false;
  }

  private async maybeBrief() {
    if (this.alerting || this.pending.length || Date.now() - this.lastBriefing < CONFIG.briefingMinutes * 60_000) return;
    this.lastBriefing = Date.now();
    const facts = briefingFacts(this.warnings, this.outlook);
    void say(await aiBriefing(facts));
  }
}

async function main() {
  await makeChime().catch((err: unknown) => log(`no chime: ${err instanceof Error ? err.message : err}`));
  // A persistent profile, because only then does Chromium open its window with --kiosk (no tabs or address bar).
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "scl-chromium-")), {
    headless: false,
    viewport: null,
    bypassCSP: true,
    locale: "en-US",
    timezoneId: "America/New_York",
    colorScheme: "dark",
    // No "controlled by automated software" bar on the stream.
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--kiosk",
      "--start-fullscreen",
      `--window-size=${CONFIG.width},${CONFIG.height}`,
      "--window-position=0,0",
      "--noerrdialogs",
      "--disable-infobars",
      "--disable-session-crashed-bubble",
      "--no-first-run",
      "--autoplay-policy=no-user-gesture-required",
      // The next scene renders in a background tab.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      // WebGL (the radar map) on a server with no GPU.
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  await context.addInitScript(() => {
    // Dark, imperial, Professional mode on, and observed radar only: no model forecast or extrapolated frames on a live stream.
    localStorage.setItem("stormcentral:v1", JSON.stringify({ state: { professional: true, theme: "dark", units: "imperial", radar: { future: false, nowcast: false } }, version: 1 }));
    localStorage.setItem("stormcentral:pro", JSON.stringify({ state: { layout: "2x2", frames: 10, speed: 1 }, version: 1 }));
  });
  const director = new Director(context);
  context.on("close", () => {
    director.closed = true;
    log("Chromium closed; exiting so systemd restarts the stream.");
    process.exit(1);
  });
  log(`Live stream director: ${CONFIG.app}, ${CONFIG.width}x${CONFIG.height}, AI briefing ${CONFIG.ollama ? CONFIG.ollama.model : "off"}.`);
  await director.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
