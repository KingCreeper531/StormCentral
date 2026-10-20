/**
 * The 24/7 live stream's director (stream/run.sh starts it on the VPS). It
 * drives the Storm Central web app in a real Chromium window on the virtual
 * screen that ffmpeg sends to YouTube Live:
 *
 * - every minute it reads the NWS's active warnings; scenes cycle through the
 *   national radar, the most serious warnings and Professional mode, tornado
 *   warnings first (plan.ts);
 * - a new tornado warning, emergency or destructive storm cuts in: its alert
 *   sound, a full-width takeover, and the warning read aloud in fixed
 *   sentences from its own text, with captions;
 * - the stream's title follows what's happening ("Watching a strengthening
 *   storm near Moore, OK…"), and each warning read out is cut from the stream
 *   into a Short (both with YouTube credentials, within a daily budget);
 * - every 20 minutes or so, a short briefing: the warning counts and SPC's
 *   outlook, reworded by the local AI (Ollama) when it's on and its version
 *   passes the fact check, read as written otherwise.
 *
 * The next scene loads in a second tab and swaps in when it's ready, behind a
 * branded wipe. Sound goes to the PulseAudio sink "stream", which ffmpeg
 * records. Anything going badly wrong ends the process; systemd starts the
 * whole stream again.
 *
 *   node director.mjs      (env: see CONFIG below; stream.env on the VPS)
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { RawAlertFeature } from "../src/lib/alerts";
import { regionOf } from "../shorts/meta";
import { parseOutlook } from "../shorts/spc-outlook";
import { accessToken, credentialsFromEnv, liveVideoId, setVideoTitle, uploadVideo } from "../shorts/youtube";
import { drawOverlay, type OverlayState } from "./overlay";
import {
  activeWarnings,
  announcement,
  briefingFacts,
  briefingPrompt,
  checkBriefing,
  clipText,
  countsOf,
  cycle,
  liveTitle,
  outlookBadge,
  sceneText,
  strengthened,
  tickerItems,
  worthAnnouncing,
  type AlertLevel,
  type Outlook,
  type Scene,
  type Strengthening,
  type StreamWarning,
} from "./plan";

const run = promisify(execFile);
const env = process.env;
const CONFIG = {
  app: (env.STREAM_APP_URL || "https://storm-central-pi.vercel.app").replace(/\/$/, ""),
  width: Number(env.STREAM_WIDTH) || 1280,
  height: Number(env.STREAM_HEIGHT) || 720,
  voice: env.STREAM_VOICE || "en-US-AndrewNeural",
  sink: env.STREAM_SINK || "stream",
  tmp: env.STREAM_TMP || "/tmp/stormcentral-stream",
  sounds: env.STREAM_SOUNDS || "",
  segments: env.STREAM_SEGMENTS || "",
  ollama: env.OLLAMA_MODEL ? { host: env.OLLAMA_HOST || "http://127.0.0.1:11434", model: env.OLLAMA_MODEL } : null,
  briefingMinutes: Number(env.STREAM_BRIEFING_MINUTES) || 20,
  heartbeat: env.STREAM_HEARTBEAT || "",
  youtube: credentialsFromEnv(env),
  /** Live title changes a day (each costs ~51 of YouTube's 10,000 daily quota units). */
  titleBudget: Number(env.STREAM_TITLE_DAILY_MAX ?? 40),
  /** Clips posted as Shorts a day (each upload costs 1,600 units, shared with the Shorts workflow). */
  clipBudget: Number(env.STREAM_CLIPS_DAILY_MAX ?? 2),
};
const UA = "StormCentralLive/1.0 (github.com/KingCreeper531/StormCentral)";
const NWS = "https://api.weather.gov";
const EVENTS = "Tornado Warning,Severe Thunderstorm Warning,Flash Flood Warning,Extreme Wind Warning";
const HOME = { lat: 35.47, lon: -97.52, name: "Oklahoma City" };
const ACCENT = { national: "#4f8cff", pro: "#a77bff" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** YouTube's quota day runs on Pacific time. */
const quotaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(Date.now());

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

// ── Sound ─────────────────────────────────────────────────────────────────

let speaking: Promise<void> = Promise.resolve();
const play = (file: string) => run("paplay", [`--device=${CONFIG.sink}`, file], { timeout: 180_000 });

/**
 * Reads `text` on the stream, one thing at a time in order: the alert sound
 * first (sounds.sh), then the voice, cleaned up like a broadcast mic (rumble
 * cut, gentle compression, normalized loudness). `onAir` runs as the voice
 * starts and stops, for the captions.
 */
function say(text: string, sound: AlertLevel | "update" | null, onAir: (on: boolean) => void = () => {}): Promise<void> {
  speaking = speaking.then(async () => {
    try {
      const mp3 = join(CONFIG.tmp, "say.mp3"), wav = join(CONFIG.tmp, "say.wav");
      await run("edge-tts", ["--voice", CONFIG.voice, "--rate", "-4%", "--text", text, "--write-media", mp3], { timeout: 60_000 });
      await run("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-af", "highpass=f=85,acompressor=threshold=-20dB:ratio=3:attack=5:release=150:makeup=2,loudnorm=I=-15:TP=-1.5:LRA=7", "-ar", "48000", "-ac", "2", wav]);
      const tone = sound && CONFIG.sounds ? join(CONFIG.sounds, `${sound}.wav`) : "";
      if (tone && existsSync(tone)) await play(tone);
      onAir(true);
      await play(wav);
    } catch (err) {
      log(`couldn't speak: ${errText(err)}`);
    } finally {
      onAir(false);
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
    log(`AI briefing unavailable: ${errText(err)}`);
    return facts;
  }
}

// ── YouTube: the live title and clips ─────────────────────────────────────

/** A daily allowance, counted on YouTube's Pacific-time quota day. */
class Budget {
  private day = quotaDay();
  private used = 0;
  constructor(private max: number) {}
  take(): boolean {
    if (this.day !== quotaDay()) [this.day, this.used] = [quotaDay(), 0];
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

class YouTube {
  private token: { value: string; at: number } | null = null;
  private live: { id: string | null; at: number } = { id: null, at: 0 };
  private title = "";
  private titledAt = 0;
  private titles = new Budget(CONFIG.titleBudget);
  private clips = new Budget(CONFIG.clipBudget);

  get enabled() {
    return !!CONFIG.youtube;
  }

  private async auth() {
    if (!this.token || Date.now() - this.token.at > 45 * 60_000) this.token = { value: await accessToken(CONFIG.youtube!), at: Date.now() };
    return this.token.value;
  }

  /** The live broadcast's id (looked up every 10 minutes: a restart starts a new broadcast). */
  async liveId(): Promise<string | null> {
    if (!this.enabled) return null;
    if (Date.now() - this.live.at > 10 * 60_000) this.live = { id: await liveVideoId(await this.auth()).catch(() => null), at: Date.now() };
    return this.live.id;
  }

  /** Sets the title when it says something new: at most every 10 minutes (an emergency at once), within the day's budget. */
  async retitle(title: string, urgent: boolean) {
    if (!this.enabled || title === this.title || (!urgent && Date.now() - this.titledAt < 10 * 60_000)) return;
    const id = await this.liveId();
    if (!id || !this.titles.take()) return;
    try {
      await setVideoTitle(id, title, await this.auth());
      [this.title, this.titledAt] = [title, Date.now()];
      log(`title: ${title}`);
    } catch (err) {
      log(`couldn't change the title: ${errText(err)}`);
    }
  }

  /**
   * Cuts the stream from a few seconds before `from` to `to` out of the rolling
   * recording (run.sh), makes it vertical with the warning on top, and posts it
   * as a Short.
   */
  async clip(w: StreamWarning, from: number, to: number) {
    // Tests: STREAM_CLIPS_DRY=<file> renders the clip there without posting it.
    const dry = env.STREAM_CLIPS_DRY;
    if ((!this.enabled && !dry) || !CONFIG.segments || !this.clips.take()) return;
    try {
      const segs = readdirSync(CONFIG.segments)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => ({ f: join(CONFIG.segments, f), t: statSync(join(CONFIG.segments, f)).mtimeMs }))
        .filter((s) => s.t >= from - 4_000 && s.t <= to + 8_000)
        .sort((a, b) => a.t - b.t);
      if (segs.length < 3) return log("clip: not enough of the recording yet");
      const list = join(CONFIG.tmp, "clip.txt"), raw = join(CONFIG.tmp, "clip-raw.ts"), out = join(CONFIG.tmp, "clip.mp4");
      writeFileSync(list, segs.map((s) => `file '${s.f}'`).join("\n"));
      await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", raw], { timeout: 120_000 });
      const { title, subtitle } = sceneText(w);
      const text = (s: string) => s.replace(/[\\:'%]/g, (c) => `\\${c}`);
      // 1080x1920: the stream, blurred, behind itself at full width; the warning above, the channel below.
      const vf = [
        "[0:v]split[a][b]",
        "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.22[bg]",
        "[b]scale=1080:-2[fg]",
        "[bg][fg]overlay=(W-w)/2:(H-h)/2+40",
        `drawtext=font='Inter\\:style=Black':text='${text(title)}':fontcolor=${w.color}:fontsize=74:x=(w-text_w)/2:y=330:borderw=4:bordercolor=black@0.6`,
        `drawtext=font='Inter\\:style=Bold':text='${text(subtitle)}':fontcolor=white:fontsize=40:x=max(40\\,(w-text_w)/2):y=430:borderw=3:bordercolor=black@0.6`,
        "drawtext=font='Inter\\:style=Bold':text='LIVE 24/7 · STORM CENTRAL':fontcolor=white@0.9:fontsize=44:x=(w-text_w)/2:y=1530",
      ].join(",");
      await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-filter_complex", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-t", "58", "-movflags", "+faststart", out], { timeout: 600_000 });
      if (dry) {
        await run("cp", [out, dry]);
        return log(`clip rendered (not posted): ${dry}`);
      }
      const live = await this.liveId();
      const meta = clipText(w, live ? `https://youtu.be/${live}` : null);
      const id = await uploadVideo(out, { ...meta, privacy: env.STREAM_CLIPS_PRIVACY || "public" }, await this.auth());
      log(`clip posted: https://youtube.com/shorts/${id}`);
    } catch (err) {
      log(`clip failed: ${errText(err)}`);
    }
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
  private recent: Strengthening[] = [];
  private interrupt: (() => void) | null = null;
  private pending: StreamWarning[] = [];
  private youtube = new YouTube();
  private overlay: OverlayState = {
    scene: { title: "NATIONAL RADAR", subtitle: "", color: ACCENT.national },
    counts: [],
    outlook: null,
    ticker: [],
    banner: null,
    caption: null,
  };
  // The first briefing comes two minutes in, so someone tuning in soon after a restart hears one.
  private lastBriefing = Date.now() - (CONFIG.briefingMinutes - 2) * 60_000;
  private alerting = false;
  closed = false;

  constructor(private context: BrowserContext) {}

  async start() {
    this.front = this.context.pages()[0] ?? (await this.context.newPage());
    this.back = await this.context.newPage();
    this.outlook = await fetchOutlook().catch(() => null);
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

  /** Reads the warnings; new ones worth it go to the front of the queue, and the title follows. */
  private async refresh(first = false) {
    try {
      const ws = await fetchWarnings();
      const fresh = ws.filter((w) => !this.seen.has(w.key));
      for (const w of ws) this.seen.add(w.key);
      if (!first) this.recent = [...this.recent.filter((r) => Date.now() - r.at < 60 * 60_000), ...strengthened(this.warnings, ws)];
      this.warnings = ws;
      // Warnings already out when the stream starts aren't news; only ones issued while it runs.
      if (!first) {
        const urgent = [...fresh.filter(worthAnnouncing), ...this.recent.filter((r) => Date.now() - r.at < 90_000 && !fresh.includes(r.warning)).map((r) => r.warning)];
        if (urgent.length) {
          this.pending = [...this.pending, ...urgent].sort((a, b) => b.rank - a.rank).slice(0, 4);
          this.interrupt?.();
        }
      }
      this.overlay = { ...this.overlay, counts: countsOf(ws), outlook: outlookBadge(this.outlook), ticker: tickerItems(ws) };
      await this.paint();
      const urgentTitle = ws.some((w) => w.level === "emergency");
      await this.youtube.retitle(liveTitle(ws, this.outlook, this.recent), urgentTitle);
    } catch (err) {
      log(`warnings: ${errText(err)}`);
    }
  }

  private async watch() {
    let n = 0;
    for (;;) {
      await sleep(60_000);
      if (++n % 30 === 0) this.outlook = await fetchOutlook().catch(() => this.outlook);
      await this.refresh();
      await this.maybeBrief();
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

  private sceneOverlay(scene: Scene): OverlayState["scene"] {
    if (scene.kind === "national") {
      const n = this.warnings.length;
      return { title: "NATIONAL RADAR", subtitle: n ? `${n} warning${n === 1 ? "" : "s"} in effect · tornado warnings first` : "No tornado, severe thunderstorm or flash flood warnings right now", color: ACCENT.national };
    }
    if (scene.kind === "pro") {
      return scene.warning
        ? { title: "PROFESSIONAL MODE", subtitle: `Reflectivity · Velocity · Storm-relative · Composite — ${sceneText(scene.warning).subtitle}`, color: ACCENT.pro, ends: scene.warning.ends }
        : { title: "PROFESSIONAL MODE", subtitle: `Reflectivity · Velocity · Storm-relative · Composite — ${HOME.name}`, color: ACCENT.pro };
    }
    return { ...sceneText(scene.warning), color: scene.warning.color, ends: scene.warning.ends };
  }

  /** Loads the scene in the back tab, then swaps it to the front. */
  private async show(scene: Scene, banner: OverlayState["banner"] = null) {
    const page = this.back;
    try {
      // The scene loads and settles in the background tab while the current one stays on air.
      await page.goto(urlFor(scene), { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(scene.kind === "pro" ? 8_000 : 5_000);
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
      // Graphics on, then on air: the branded wipe sweeps off the finished scene.
      this.overlay = { ...this.overlay, scene: this.sceneOverlay(scene), banner };
      await page.evaluate(drawOverlay, this.overlay);
      await page.bringToFront();
      [this.front, this.back] = [page, this.front];
      log(`scene: ${this.overlay.scene.title} · ${this.overlay.scene.subtitle}`);
    } catch (err) {
      log(`scene failed (${urlFor(scene)}): ${errText(err)}`);
      if (page.isClosed() || this.closed) throw err;
    }
  }

  private async alertScene(w: StreamWarning) {
    log(`NEW: ${w.name} (${w.key})`);
    this.alerting = true;
    const from = Date.now();
    const why = this.recent.find((r) => r.warning.key === w.key && Date.now() - r.at < 90_000)?.why;
    await this.show(
      { kind: "warning", warning: w, seconds: 40 },
      { kicker: why ? `UPGRADED · ${why.toUpperCase()}` : "NEW WARNING", title: w.name.toUpperCase(), places: sceneText(w).subtitle, chips: w.chips, color: w.color },
    );
    const spoken = say(announcement(w), w.level, (on) => {
      this.overlay = { ...this.overlay, caption: on ? announcement(w) : null };
      void this.paint();
    });
    await Promise.race([spoken, sleep(60_000)]);
    await sleep(10_000);
    this.overlay = { ...this.overlay, banner: null };
    await this.paint();
    this.lastBriefing = Date.now();
    this.alerting = false;
    // The clip: from the cut-in to now, posted in the background.
    if (w.level !== "severe") void this.youtube.clip(w, from, Date.now());
  }

  private async maybeBrief() {
    if (this.alerting || this.pending.length || Date.now() - this.lastBriefing < CONFIG.briefingMinutes * 60_000) return;
    this.lastBriefing = Date.now();
    const text = `Storm Central update. ${await aiBriefing(briefingFacts(this.warnings, this.outlook))}`;
    void say(text, "update", (on) => {
      this.overlay = { ...this.overlay, caption: on ? text : null };
      void this.paint();
    });
  }
}

async function main() {
  mkdirSync(CONFIG.tmp, { recursive: true });
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
  log(
    `Live stream director: ${CONFIG.app}, ${CONFIG.width}x${CONFIG.height}, AI briefing ${CONFIG.ollama ? CONFIG.ollama.model : "off"}, ` +
      `YouTube titles and clips ${CONFIG.youtube ? `on (${CONFIG.titleBudget} titles, ${CONFIG.clipBudget} clips a day)` : "off (no YT_* credentials)"}.`,
  );
  await director.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
