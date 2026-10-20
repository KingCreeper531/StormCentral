/**
 * The 24/7 live stream's director (stream/run.sh starts it on the VPS). It
 * drives the Storm Central web app in a real Chromium window on the virtual
 * screen that ffmpeg sends to YouTube Live, and decides what's on air:
 *
 * - Data, all the time: the NWS's active warnings every 30 seconds, storm
 *   reports and live cameras from Storm Central's own feeds, and SPC's outlook.
 * - Priority: tornado warnings first, then the rest by severity (plan.ts).
 *   Scenes cycle through the national radar, each warning, Professional mode,
 *   and the HRRR model's next hours on quiet days with a severe risk.
 * - Breaking: a new or upgraded tornado warning, emergency or destructive storm
 *   cuts in with its alert sound, a full-width takeover, and the warning read
 *   in fixed sentences from its own text, with captions. A tornado reported
 *   near a warned storm is read out too.
 * - Commentary: every few minutes during warnings, the storm's position,
 *   motion, the towns in its path with arrival times, and nearby reports,
 *   worked out exactly (analysis.ts) and put into words by the best AI
 *   available (llm.ts: Claude, Gemini, an OpenAI-compatible API, the local
 *   model), each version fact-checked before it's read; a briefing every 20
 *   minutes when it's quiet.
 * - YouTube: the title follows what's happening, and each warning read out
 *   is cut into a Short (youtube-live.ts).
 * - Control: a local HTTP API to show a place, pin a warning, say something
 *   or set the title (control.ts).
 *
 * Scenes load fully in a second tab and swap in behind a branded wipe. Sound
 * goes to the PulseAudio sink "stream", which ffmpeg records. Seen warnings
 * are saved, so a restart doesn't miss or repeat one. Anything going badly
 * wrong ends the process; systemd starts the whole stream again.
 *
 *   node director.mjs      (env: see CONFIG below; stream.env on the VPS)
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { RawAlertFeature } from "../src/lib/alerts";
import type { StormReport, StormReportsResponse } from "../src/lib/feeds/storm-reports";
import { haversineKm } from "../src/lib/geo";
import { toWebcam, WEBCAM_SOURCES, webcamImageAt, type Webcam, type WebcamsResponse } from "../src/lib/webcams";
import { regionOf } from "../shorts/meta";
import { parseOutlook } from "../shorts/spc-outlook";
import { credentialsFromEnv } from "../shorts/youtube";
import { checkAgainst, commentaryFacts, loadPlaces, notable, reportSentence, reportsNear, stormFacts, type Place } from "./analysis";
import { startControl } from "./control";
import { writeChecked, writersFromEnv } from "./llm";
import { drawOverlay, type OverlayState } from "./overlay";
import {
  activeWarnings,
  announcement,
  briefingFacts,
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
import { YouTubeLive } from "./youtube-live";

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
  places: env.STREAM_PLACES || "",
  state: env.STREAM_STATE || join(homedir(), "stream-state.json"),
  briefingMinutes: Number(env.STREAM_BRIEFING_MINUTES) || 20,
  commentaryMinutes: Number(env.STREAM_COMMENTARY_MINUTES) || 4,
  controlPort: Number(env.STREAM_CONTROL_PORT) || 8787,
  heartbeat: env.STREAM_HEARTBEAT || "",
};
const UA = "StormCentralLive/1.0 (github.com/KingCreeper531/StormCentral)";
const NWS = "https://api.weather.gov";
const EVENTS = "Tornado Warning,Severe Thunderstorm Warning,Flash Flood Warning,Extreme Wind Warning";
const HOME = { lat: 35.47, lon: -97.52, name: "Oklahoma City" };
const ACCENT = { national: "#4f8cff", pro: "#a77bff", model: "#2ec4b6" };
const SYSTEM =
  "You are the voice of Storm Central Live, a calm, clear 24/7 weather radar stream, speaking like an experienced broadcast meteorologist. " +
  "You only put the facts you're given into natural spoken English: never add numbers, places, times, hazards or advice that aren't in them, and never speculate. " +
  "No greetings, no hashtags, no emoji. Write numbers as digits.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

/** The last hour's NWS storm reports, from Storm Central's own feed. */
const fetchReports = async () => (await getJson<StormReportsResponse>(`${CONFIG.app}/api/storm-reports?hours=1`)).reports;
/** Public cameras (traffic, fire, river), from Storm Central's own feed. */
const fetchCameras = async () => (await getJson<WebcamsResponse>(`${CONFIG.app}/api/webcams`)).cams.map(toWebcam);

/** Tests only: the top warning of a saved NWS scenario (STREAM_DEMO_FIXTURE, STREAM_DEMO_NOW), ending 30 minutes from now. */
function demoWarning(): StreamWarning | null {
  if (!env.STREAM_DEMO_FIXTURE || !env.STREAM_DEMO_NOW) return null;
  const fc = JSON.parse(readFileSync(env.STREAM_DEMO_FIXTURE, "utf8")) as { features?: RawAlertFeature[] };
  const w = activeWarnings(fc.features ?? [], Date.parse(env.STREAM_DEMO_NOW))[0];
  return w ? { ...w, key: `demo-${w.key}`, ends: new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.\d+Z$/, "Z") } : null;
}

// ── Sound ─────────────────────────────────────────────────────────────────

let speaking: Promise<void> = Promise.resolve();
let busy = 0;
const play = (file: string) => run("paplay", [`--device=${CONFIG.sink}`, file], { timeout: 180_000 });

/**
 * Reads `text` on the stream, one thing at a time in order: the alert sound
 * first (sounds.sh), then the voice, cleaned up like a broadcast mic (rumble
 * cut, gentle compression, normalized loudness). `onAir` runs as the voice
 * starts and stops, for the captions.
 */
function say(text: string, sound: AlertLevel | "update" | null, onAir: (on: boolean) => void = () => {}): Promise<void> {
  busy++;
  speaking = speaking.then(async () => {
    try {
      const mp3 = join(CONFIG.tmp, "say.mp3"), wav = join(CONFIG.tmp, "say.wav");
      await run("edge-tts", ["--voice", CONFIG.voice, "--rate=-4%", "--text", text, "--write-media", mp3], { timeout: 60_000 });
      await run("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-af", "highpass=f=85,acompressor=threshold=-20dB:ratio=3:attack=5:release=150:makeup=2,loudnorm=I=-15:TP=-1.5:LRA=7", "-ar", "48000", "-ac", "2", wav]);
      const tone = sound && CONFIG.sounds ? join(CONFIG.sounds, `${sound}.wav`) : "";
      if (tone && existsSync(tone)) await play(tone);
      onAir(true);
      await play(wav);
    } catch (err) {
      log(`couldn't speak: ${errText(err)}`);
    } finally {
      onAir(false);
      busy--;
    }
  });
  return speaking;
}

// ── Scenes ────────────────────────────────────────────────────────────────

const urlFor = (s: Scene) => {
  const at =
    s.kind === "national" || s.kind === "model"
      ? { lat: 38.5, lon: -96.5, name: "United States" }
      : s.kind === "custom"
        ? s
        : s.warning
          ? { lat: s.warning.lat, lon: s.warning.lon, name: s.warning.areas[0]?.name ?? "Warning" }
          : HOME;
  const mode = s.kind === "pro" || (s.kind === "custom" && s.mode === "professional") ? "professional" : "severe";
  // scl_future: our own flag, read by the init script below to switch on the HRRR frames.
  return `${CONFIG.app}/?mode=${mode}&lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&name=${encodeURIComponent(at.name)}${s.kind === "model" ? "&scl_future=1" : ""}`;
};

interface SavedState {
  /** Warning key → when it was first seen (ms). */
  seen: Record<string, number>;
}

class Director {
  private front!: Page;
  private back!: Page;
  private warnings: StreamWarning[] = [];
  private seen = new Map<string, number>();
  private outlook: Outlook | null = null;
  private reports: StormReport[] = [];
  private readReports = new Set<string>();
  private cameras: Webcam[] = [];
  private recent: Strengthening[] = [];
  private interrupt: (() => void) | null = null;
  private pending: StreamWarning[] = [];
  private manual: Scene[] = [];
  private pinned: string | null = null;
  private titleOverride: string | null = null;
  private onAir: Scene | null = null;
  private places: Place[] = loadPlaces(CONFIG.places);
  private writers = writersFromEnv(env);
  private youtube = new YouTubeLive({
    credentials: credentialsFromEnv(env),
    titlesPerDay: Number(env.STREAM_TITLE_DAILY_MAX ?? 40),
    clipsPerDay: Number(env.STREAM_CLIPS_DAILY_MAX ?? 2),
    segments: env.STREAM_SEGMENTS || "",
    tmp: CONFIG.tmp,
    privacy: env.STREAM_CLIPS_PRIVACY || "public",
    dryRunClip: env.STREAM_CLIPS_DRY,
    log,
  });
  private aiTitle = { basis: "", text: "" };
  private overlay: OverlayState = {
    scene: { title: "NATIONAL RADAR", subtitle: "", color: ACCENT.national },
    counts: [],
    outlook: null,
    ticker: [],
    banner: null,
    caption: null,
    camera: null,
  };
  // The first briefing comes two minutes in, so someone tuning in soon after a restart hears one.
  private lastBriefing = Date.now() - (CONFIG.briefingMinutes - 2) * 60_000;
  private lastCommentary = 0;
  private lastReportRead = 0;
  private alerting = false;
  closed = false;

  constructor(private context: BrowserContext) {}

  async start() {
    log(`AI writers: ${this.writers.map((w) => w.name).join(" → ") || "none (facts read as written)"}; ${this.places.length} towns for distances.`);
    this.front = this.context.pages()[0] ?? (await this.context.newPage());
    this.back = await this.context.newPage();
    const restored = this.restore();
    this.outlook = await fetchOutlook().catch(() => null);
    [this.reports, this.cameras] = await Promise.all([fetchReports().catch(() => []), fetchCameras().catch(() => [])]);
    for (const r of this.reports) this.readReports.add(r.id);
    await this.refresh(restored ? "restart" : "first");
    // Tests: read the most serious warning in effect as if it had just been issued (or, with none, one
    // from a saved scenario, STREAM_DEMO_FIXTURE, moved to now).
    if (env.STREAM_DEMO_ALERT === "1") {
      const demo = this.warnings[0] ?? demoWarning();
      // After the recording has started, so the clip has something to cut.
      if (demo) setTimeout(() => (this.pending.push(demo), this.interrupt?.()), Number(env.STREAM_DEMO_DELAY ?? 40) * 1000);
    }
    startControl(CONFIG.controlPort, this.controls(), log);
    void this.watch();
    for (;;) {
      for (const scene of cycle(this.pinnedFirst(), { outlook: this.outlook })) {
        for (let urgent = this.pending.shift(); urgent; urgent = this.pending.shift()) await this.alertScene(urgent);
        for (let hand = this.manual.shift(); hand; hand = this.manual.shift()) {
          await this.show(hand);
          await this.hold(hand.seconds * 1000);
        }
        await this.show(scene);
        await this.hold(scene.seconds * 1000);
      }
    }
  }

  /** The warnings with a pinned one (control API) first. */
  private pinnedFirst() {
    const p = this.warnings.find((w) => w.key === this.pinned);
    return p ? [p, ...this.warnings.filter((w) => w !== p)] : this.warnings;
  }

  /** Warnings seen before a restart, so they're neither missed nor read again. True when there was a saved state. */
  private restore(): boolean {
    try {
      const s = JSON.parse(readFileSync(CONFIG.state, "utf8")) as SavedState;
      for (const [k, at] of Object.entries(s.seen ?? {})) if (Date.now() - at < 6 * 3_600_000) this.seen.set(k, at);
      return true;
    } catch {
      return false;
    }
  }

  private save() {
    try {
      writeFileSync(CONFIG.state, JSON.stringify({ seen: Object.fromEntries(this.seen) } satisfies SavedState));
    } catch (err) {
      log(`couldn't save the state: ${errText(err)}`);
    }
  }

  /**
   * Reads the warnings; new ones worth it go to the front of the queue, and the
   * title follows. On the very first start, warnings already out aren't news;
   * after a restart, ones issued in the last 10 minutes that weren't seen are.
   */
  private async refresh(start: "first" | "restart" | null = null) {
    try {
      const ws = await fetchWarnings();
      const now = Date.now();
      const fresh = start === "first" ? [] : ws.filter((w) => !this.seen.has(w.key) && (start !== "restart" || now - Date.parse(w.sent) < 10 * 60_000));
      for (const w of ws) if (!this.seen.has(w.key)) this.seen.set(w.key, now);
      this.recent = [...this.recent.filter((r) => now - r.at < 60 * 60_000), ...(start ? [] : strengthened(this.warnings, ws, now))];
      this.warnings = ws;
      const urgent = [...fresh.filter(worthAnnouncing), ...this.recent.filter((r) => now - r.at < 90_000 && !fresh.includes(r.warning)).map((r) => r.warning)];
      if (urgent.length) {
        this.pending = [...this.pending, ...urgent].sort((a, b) => b.rank - a.rank).slice(0, 4);
        this.interrupt?.();
      }
      this.save();
      this.overlay = { ...this.overlay, counts: countsOf(ws), outlook: outlookBadge(this.outlook), ticker: [...tickerItems(ws), ...this.reportTicker()] };
      await this.paint();
      await this.updateTitle();
    } catch (err) {
      log(`warnings: ${errText(err)}`);
    }
  }

  private reportTicker() {
    const code: Record<string, string> = { tornado: "TOR RPT", funnel: "FUNNEL", hail: "HAIL", wind: "WIND", "wind-damage": "DAMAGE", flood: "FLOOD" };
    return this.reports
      .filter(notable)
      .slice(0, 8)
      .map((r) => ({ code: code[r.kind] ?? "REPORT", color: "#7cc4ff", text: reportSentence(r, "America/Chicago").replace(/ Central time\.$/, " CT") }));
  }

  /** The title: by hand (control API), else the rules' title worded by the AI when the situation changes. */
  private async updateTitle() {
    if (this.titleOverride) return this.youtube.retitle(this.titleOverride, true);
    if (!this.youtube.enabled) return;
    const basis = liveTitle(this.warnings, this.outlook, this.recent);
    if (basis !== this.aiTitle.basis) {
      const top = this.warnings[0];
      const facts = [basis, ...(top ? commentaryFacts(top, stormFacts(top, this.places), []) : [])].join(" ");
      const ai = this.writers.length
        ? await writeChecked(
            this.writers,
            SYSTEM,
            `Write the title of the live stream right now, under 90 characters, saying what viewers are watching, like "Watching a strengthening storm near Moore, OK". Keep the most important fact of: ${facts}`,
            (t) => checkAgainst(t.replace(/\s*[|•].*$/, ""), facts, { maxWords: 16, maxChars: 90 }),
            { maxTokens: 60, log },
          )
        : null;
      this.aiTitle = { basis, text: ai ? `${ai.text}${ai.text.length <= 84 ? " • Live" : ""}` : basis };
    }
    await this.youtube.retitle(this.aiTitle.text, this.warnings.some((w) => w.level === "emergency"));
  }

  private async watch() {
    let n = 0;
    for (;;) {
      await sleep(30_000);
      n++;
      if (n % 60 === 0) this.outlook = await fetchOutlook().catch(() => this.outlook);
      if (n % 60 === 30) this.cameras = await fetchCameras().catch(() => this.cameras);
      if (n % 4 === 0) await this.checkReports();
      await this.refresh();
      await this.maybeComment();
      await this.maybeBrief();
      if (this.overlay.camera) await this.paint();
      if (CONFIG.heartbeat) writeFileSync(CONFIG.heartbeat, new Date().toISOString());
    }
  }

  /** New storm reports; a tornado reported near a warned storm is read out (at most every 3 minutes). */
  private async checkReports() {
    try {
      this.reports = await fetchReports();
    } catch {
      return;
    }
    const fresh = this.reports.filter((r) => !this.readReports.has(r.id));
    for (const r of fresh) this.readReports.add(r.id);
    const near = (r: StormReport) => this.warnings.find((w) => haversineKm(r, { lat: w.lat, lon: w.lon }) < 60);
    const tornado = fresh.find((r) => r.kind === "tornado" && near(r));
    if (tornado && !this.alerting && Date.now() - this.lastReportRead > 3 * 60_000) {
      this.lastReportRead = Date.now();
      void this.speak(`New report: ${reportSentence(tornado, near(tornado)!.zone)}`, "severe");
    }
  }

  /** Reads `text` with captions. */
  private speak(text: string, sound: AlertLevel | "update" | null) {
    return say(text, sound, (on) => {
      this.overlay = { ...this.overlay, caption: on ? text : null };
      void this.paint();
    });
  }

  /** Live commentary on the warning on air (or the most serious), every few minutes during warnings. */
  private async maybeComment() {
    const w = (this.onAir?.kind === "warning" && this.onAir.warning) || this.warnings[0];
    if (!w || this.alerting || this.pending.length || busy || Date.now() - this.lastCommentary < CONFIG.commentaryMinutes * 60_000) return;
    this.lastCommentary = Date.now();
    const f = stormFacts(w, this.places);
    const lines = commentaryFacts(w, f, reportsNear(this.reports, f.at));
    const facts = lines.join(" ");
    const ai = await writeChecked(this.writers, SYSTEM, `Give 2 or 3 sentences of live commentary on this storm for the stream, most important first, using only these facts: ${facts}`, (t) => checkAgainst(t, facts, { maxWords: 70 }), { log });
    // Without an AI (or when none passes), the facts themselves: where it is, where it's heading.
    const text = ai?.text ?? (lines.slice(1, 3).join(" ") || lines[0]!);
    const safety = w.event === "Tornado Warning" ? " If you're in the warned area, get to your safe place now." : "";
    log(`commentary${ai ? ` (${ai.by})` : ""}: ${text}`);
    void this.speak(text + safety, null);
  }

  private async maybeBrief() {
    if (this.alerting || this.pending.length || busy || this.warnings.length || Date.now() - this.lastBriefing < CONFIG.briefingMinutes * 60_000) return;
    this.lastBriefing = Date.now();
    const facts = briefingFacts(this.warnings, this.outlook);
    const ai = await writeChecked(this.writers, SYSTEM, `Rewrite these facts as a short, friendly spoken update (2 sentences, at most 45 words): ${facts}`, (t) => checkAgainst(t, facts, { maxWords: 50 }), { log });
    void this.speak(`Storm Central update. ${ai?.text ?? facts}`, "update");
  }

  /** Waits `ms`, or less when a new warning (or a hand-picked scene) comes in. */
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
    const shown = this.overlay.camera;
    if (shown) {
      const cam = this.cameras.find((c) => c.name === shown.name);
      if (cam) this.overlay = { ...this.overlay, camera: { ...shown, url: webcamImageAt(cam, Date.now()) } };
    }
    await this.front?.evaluate(drawOverlay, this.overlay).catch(() => {});
  }

  /** The nearest public camera within 60 km of the storm, if any. */
  private cameraFor(w: StreamWarning): OverlayState["camera"] {
    const at = stormFacts(w, []).at;
    const best = this.cameras
      .map((c) => ({ c, km: haversineKm(c, at) }))
      .filter((x) => x.km < 60)
      .sort((a, b) => a.km - b.km)[0];
    return best ? { url: webcamImageAt(best.c, Date.now()), name: best.c.name, credit: WEBCAM_SOURCES[best.c.source].credit } : null;
  }

  private sceneOverlay(scene: Scene): OverlayState["scene"] {
    switch (scene.kind) {
      case "national": {
        const n = this.warnings.length;
        return { title: "NATIONAL RADAR", subtitle: n ? `${n} warning${n === 1 ? "" : "s"} in effect · tornado warnings first` : "No tornado, severe thunderstorm or flash flood warnings right now", color: ACCENT.national };
      }
      case "model":
        return { title: "HRRR MODEL FORECAST", subtitle: "The next hours as the HRRR model sees them · a forecast, not observed radar", color: ACCENT.model };
      case "custom":
        return { title: scene.mode === "professional" ? "PROFESSIONAL MODE" : "LIVE RADAR", subtitle: scene.name, color: scene.mode === "professional" ? ACCENT.pro : ACCENT.national };
      case "pro":
        return scene.warning
          ? { title: "PROFESSIONAL MODE", subtitle: `Reflectivity · Velocity · Storm-relative · Composite — ${sceneText(scene.warning).subtitle}`, color: ACCENT.pro, ends: scene.warning.ends }
          : { title: "PROFESSIONAL MODE", subtitle: `Reflectivity · Velocity · Storm-relative · Composite — ${HOME.name}`, color: ACCENT.pro };
      case "warning": {
        const { title, subtitle } = sceneText(scene.warning);
        const f = stormFacts(scene.warning, this.places);
        const where = [f.near, f.moving].filter(Boolean).join(" · ");
        return { title, subtitle: where ? `${where} · until ${subtitle.split(" · until ")[1]}` : subtitle, color: scene.warning.color, ends: scene.warning.ends };
      }
    }
  }

  /** Loads the scene in the back tab, then swaps it to the front. */
  private async show(scene: Scene, banner: OverlayState["banner"] = null) {
    const page = this.back;
    try {
      // The scene loads and settles in the background tab while the current one stays on air.
      await page.goto(urlFor(scene), { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(scene.kind === "pro" || (scene.kind === "custom" && scene.mode === "professional") ? 8_000 : 5_000);
      // The side panel (warnings list, tools) would cover part of the map; the overlay shows what matters.
      await page
        .getByRole("button", { name: "Hide panel" })
        .first()
        .click({ timeout: 3_000 })
        .catch(() => {});
      if (scene.kind === "national" || scene.kind === "model") {
        // The whole country: zoom out from the app's local view.
        await page.mouse.move(CONFIG.width / 2, CONFIG.height / 2);
        for (let i = 0; i < 4; i++) {
          await page.mouse.wheel(0, 360);
          await page.waitForTimeout(250);
        }
      }
      // Graphics on, then on air: the branded wipe sweeps off the finished scene.
      const camera = scene.kind === "warning" ? this.cameraFor(scene.warning) : null;
      this.overlay = { ...this.overlay, scene: this.sceneOverlay(scene), banner, camera };
      await page.evaluate(drawOverlay, this.overlay);
      await page.bringToFront();
      [this.front, this.back] = [page, this.front];
      this.onAir = scene;
      log(`scene: ${this.overlay.scene.title} · ${this.overlay.scene.subtitle}${camera ? ` · camera ${camera.name}` : ""}`);
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
    await Promise.race([this.speak(announcement(w), w.level), sleep(60_000)]);
    await sleep(10_000);
    this.overlay = { ...this.overlay, banner: null };
    await this.paint();
    this.lastBriefing = Date.now();
    // Commentary on the new storm a minute after the read-out.
    this.lastCommentary = Date.now() - (CONFIG.commentaryMinutes - 1) * 60_000;
    this.alerting = false;
    // The clip: from the cut-in to now, posted in the background.
    if (w.level !== "severe") void this.youtube.clip(w, from, Date.now());
  }

  private controls() {
    return {
      state: () => ({
        onAir: this.overlay.scene,
        title: this.titleOverride ?? this.youtube.title,
        pinned: this.pinned,
        writers: this.writers.map((w) => w.name),
        warnings: this.warnings.map((w) => ({ key: w.key, name: w.name, where: sceneText(w).subtitle })),
      }),
      show: (p: { lat: number; lon: number; name: string; mode: "severe" | "professional"; seconds: number }) => {
        this.manual.push({ kind: "custom", ...p });
        this.interrupt?.();
      },
      pin: (key: string | null) => {
        if (key && !this.warnings.some((w) => w.key === key)) return false;
        this.pinned = key;
        return true;
      },
      say: (text: string) => void this.speak(text, null),
      title: (text: string | null) => {
        this.titleOverride = text;
        void this.updateTitle();
      },
    };
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
    // Dark, imperial, Professional mode on, and observed radar only (no model forecast or extrapolated
    // frames), except in the HRRR scene, which asks for the model's frames with ?scl_future=1.
    const future = new URLSearchParams(location.search).get("scl_future") === "1";
    localStorage.setItem("stormcentral:v1", JSON.stringify({ state: { professional: true, theme: "dark", units: "imperial", radar: { future, nowcast: false } }, version: 1 }));
    localStorage.setItem("stormcentral:pro", JSON.stringify({ state: { layout: "2x2", frames: 10, speed: 1 }, version: 1 }));
  });
  const director = new Director(context);
  context.on("close", () => {
    director.closed = true;
    log("Chromium closed; exiting so systemd restarts the stream.");
    process.exit(1);
  });
  log(`Live stream director: ${CONFIG.app}, ${CONFIG.width}x${CONFIG.height}, YouTube titles and clips ${credentialsFromEnv(env) ? "on" : "off (no YT_* credentials)"}.`);
  await director.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
