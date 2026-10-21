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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
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
import { alertsText, ChatReader, Cooldowns, fetchAlerts, fetchForecast, findPlace, forecastText, geocode, HELP, parseCommand, postChat, type ChatMessage } from "./chat";
import { startControl } from "./control";
import { writeChecked, writersFromEnv } from "./llm";
import { drawOverlay, type OverlayState } from "./overlay";
import {
  annotateWarning,
  activeWarnings,
  announcement,
  briefingFacts,
  countsOf,
  cycle,
  isMajor,
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
import { paceFrames } from "./pace";
import { Budget, YouTubeLive, type BudgetState } from "./youtube-live";

const run = promisify(execFile);
const env = process.env;
/** 2 CPUs or fewer: the stream's lighter defaults (map scale, light mode). */
const SMALL = availableParallelism() <= 2;
const CONFIG = {
  app: (env.STREAM_APP_URL || "https://app.stormcentralwx.com").replace(/\/$/, ""),
  width: Number(env.STREAM_WIDTH) || 1280,
  height: Number(env.STREAM_HEIGHT) || 720,
  // What run.sh captures; pace.ts keeps Chromium from drawing more than that.
  fps: Number(env.STREAM_FPS) || 30,
  // The radar map's resolution: below 1 it's drawn smaller and scaled up to the screen, the graphics over it
  // stay sharp. Without a GPU, the map's pixels are most of what Chromium does each frame.
  // 0.75 by default with 2 CPUs or fewer: on 2 cores it cut Chromium's graphics work per new frame by a quarter.
  mapScale: Math.min(1, Math.max(0.5, Number(env.STREAM_MAP_SCALE) || (SMALL ? 0.75 : 1))),
  // Nothing in constant motion (the ticker flips, a steady LIVE dot, the radar loop steps without fading), so a
  // small server's Chromium draws only when something changes and has no motion to stutter. On with 2 CPUs or fewer.
  light: env.STREAM_LIGHT ? env.STREAM_LIGHT === "on" : SMALL,
  // A public camera beside a warned storm: off unless asked for (one more picture to fetch and draw).
  cameras: env.STREAM_CAMERAS === "on",
  voice: env.STREAM_VOICE || "en-US-AndrewNeural",
  sink: env.STREAM_SINK || "stream",
  tmp: env.STREAM_TMP || "/tmp/stormcentral-stream",
  // Chromium's profile, emptied at each start: on disk, not in STREAM_TMP (in memory under /run on the VPS).
  profile: env.STREAM_PROFILE || join(tmpdir(), "stormcentral-chromium"),
  sounds: env.STREAM_SOUNDS || "",
  places: env.STREAM_PLACES || "",
  state: env.STREAM_STATE || join(homedir(), "stream-state.json"),
  briefingMinutes: Number(env.STREAM_BRIEFING_MINUTES) || 20,
  commentaryMinutes: Number(env.STREAM_COMMENTARY_MINUTES) || 4,
  controlPort: Number(env.STREAM_CONTROL_PORT) || 8787,
};
/** A vertical (9:16) stream, for the Shorts feed: the overlay's portrait layout (overlay.ts), and scenes framed to match. */
const PORTRAIT = CONFIG.height > CONFIG.width;
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
// Only sources whose owners allow it on the stream (one this build doesn't know is skipped, not shown).
const fetchCameras = async () =>
  (await getJson<WebcamsResponse>(`${CONFIG.app}/api/webcams`)).cams.map(toWebcam).filter((c) => WEBCAM_SOURCES[c.source]?.onStream);

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
  // scl_draw: the app shows the presenter's drawing and the director's own (components/draw/live-drawing).
  return `${CONFIG.app}/?mode=${mode}&lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&name=${encodeURIComponent(at.name)}${s.kind === "model" ? "&scl_future=1" : ""}&scl_draw=1`;
};

interface SavedState {
  /** Warning key → when it was first seen (ms). */
  seen: Record<string, number>;
  /** What's used of YouTube's daily budgets (Director.budgets), so a restart doesn't start the day's quota over. */
  budgets?: Record<string, BudgetState>;
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
  /** Tests: the demo warning, kept in the list as if it came from the feed. */
  private extra: StreamWarning[] = [];
  private manual: Scene[] = [];
  private pinned: string | null = null;
  private titleOverride: string | null = null;
  private onAir: Scene | null = null;
  private places: Place[] = loadPlaces(CONFIG.places);
  private writers = writersFromEnv(env);
  private youtube = new YouTubeLive({
    credentials: credentialsFromEnv(env),
    titlesPerDay: Number(env.STREAM_TITLE_DAILY_MAX ?? 20),
    clipsPerDay: Number(env.STREAM_CLIPS_DAILY_MAX ?? 1),
    segments: env.STREAM_SEGMENTS || "",
    tmp: CONFIG.tmp,
    privacy: env.STREAM_CLIPS_PRIVACY || "public",
    dryRunClip: env.STREAM_CLIPS_DRY,
    streamKey: env.YT_STREAM_KEY || undefined,
    onBudget: () => this.save(),
    log,
  });
  private aiTitle = { basis: "", text: "" };
  /** A title being written (in the background; see retitleSoon). */
  private titling = false;
  /** Viewers' chat commands (needs the YouTube credentials; STREAM_CHAT=off turns it off). */
  private chat: ChatReader | null = null;
  private chatCooldowns = new Cooldowns();
  private chatReplies = new Budget(Number(env.STREAM_CHAT_REPLIES_DAILY_MAX ?? 60), () => this.save());
  private viewerRadarAt = 0;
  private cardTimer: ReturnType<typeof setTimeout> | null = null;
  private overlay: OverlayState = {
    scene: { title: "NATIONAL RADAR", subtitle: "", color: ACCENT.national },
    counts: [],
    outlook: null,
    ticker: [],
    banner: null,
    caption: null,
    camera: null,
    light: CONFIG.light,
  };
  // The first briefing comes two minutes in, so someone tuning in soon after a restart hears one.
  private lastBriefing = Date.now() - (CONFIG.briefingMinutes - 2) * 60_000;
  private lastCommentary = 0;
  private lastReportRead = 0;
  private alerting = false;
  /** How the first successful read of the warnings treats the ones already out (see refresh). */
  private startMode: "first" | "restart" | null = null;
  closed = false;

  constructor(private context: BrowserContext) {}

  async start() {
    log(`AI writers: ${this.writers.map((w) => w.name).join(" → ") || "none (facts read as written)"}; ${this.places.length} towns for distances.`);
    this.front = this.context.pages()[0] ?? (await this.context.newPage());
    this.back = await this.context.newPage();
    // What draws the radar map (no GPU: SwiftShader, or Mesa's llvmpipe when it's installed), for tuning.
    const gl = await this.front
      .evaluate(() => {
        const c = document.createElement("canvas").getContext("webgl2");
        const info = c?.getExtension("WEBGL_debug_renderer_info");
        return c ? String(c.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : c.RENDERER)) : "no WebGL2";
      })
      .catch((err: unknown) => errText(err));
    log(`graphics: ${gl}`);
    const restored = this.restore();
    this.outlook = await fetchOutlook().catch(() => null);
    [this.reports, this.cameras] = await Promise.all([fetchReports().catch(() => []), CONFIG.cameras ? fetchCameras().catch(() => []) : []]);
    for (const r of this.reports) this.readReports.add(r.id);
    this.startMode = restored ? "restart" : "first";
    await this.refresh();
    // Tests: read the most serious warning in effect as if it had just been issued, one that gets a clip
    // (above "severe"), or else one from a saved scenario, STREAM_DEMO_FIXTURE, moved to now. A live
    // severe thunderstorm warning alone would leave the test with nothing to clip.
    if (env.STREAM_DEMO_ALERT === "1") {
      const demo = this.warnings.find((w) => w.level !== "severe") ?? demoWarning();
      // After the recording has started, so the clip has something to cut.
      // And a viewer asking for a forecast in chat, 20 seconds in.
      setTimeout(() => void this.onChat({ id: "demo", author: "demo", moderator: true, text: "!forecast Moore, OK", at: Date.now() }).catch((err) => log(`chat command: ${errText(err)}`)), 20_000);
      if (demo)
        setTimeout(() => {
          if (!this.warnings.includes(demo)) [this.extra, this.warnings] = [[demo], [demo, ...this.warnings]];
          this.seen.set(demo.key, Date.now());
          this.pending.push(demo);
          this.interrupt?.();
        }, Number(env.STREAM_DEMO_DELAY ?? 40) * 1000);
    }
    startControl(CONFIG.controlPort, this.controls(), log);
    if (this.youtube.enabled && env.STREAM_CHAT !== "off") {
      this.chat = new ChatReader({
        token: () => this.youtube.auth(),
        chatId: () => this.youtube.chatId(),
        onMessage: (m) => void this.onChat(m).catch((err) => log(`chat command: ${errText(err)}`)),
        log,
      });
      void this.chat.run();
      log("chat commands on: !forecast, !alerts, !radar, !help");
    }
    void this.watch();
    void this.talk();
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

  /** YouTube's daily budgets, by their names in the saved state. */
  private budgets() {
    return { titles: this.youtube.titles, clips: this.youtube.clips, chatReplies: this.chatReplies };
  }

  /** Warnings seen before a restart, so they're neither missed nor read again, and the day's budgets so far. True when there was a saved state. */
  private restore(): boolean {
    try {
      const s = JSON.parse(readFileSync(CONFIG.state, "utf8")) as SavedState;
      for (const [k, at] of Object.entries(s.seen ?? {})) if (Date.now() - at < 6 * 3_600_000) this.seen.set(k, at);
      for (const [name, b] of Object.entries(this.budgets())) b.restore(s.budgets?.[name]);
      return true;
    } catch {
      return false;
    }
  }

  private save() {
    try {
      const budgets = Object.fromEntries(Object.entries(this.budgets()).map(([name, b]) => [name, b.state]));
      writeFileSync(CONFIG.state, JSON.stringify({ seen: Object.fromEntries(this.seen), budgets } satisfies SavedState));
    } catch (err) {
      log(`couldn't save the state: ${errText(err)}`);
    }
  }

  /**
   * Reads the warnings; new ones worth it go to the front of the queue, and the
   * title follows. On the very first start, warnings already out aren't news;
   * after a restart, ones issued in the last 10 minutes that weren't seen are.
   */
  private async refresh() {
    try {
      const now = Date.now();
      this.extra = this.extra.filter((w) => Date.parse(w.ends) > now);
      const ws = [...(await fetchWarnings()), ...this.extra];
      const start = this.startMode;
      this.startMode = null;
      const fresh = start === "first" ? [] : ws.filter((w) => !this.seen.has(w.key) && (start !== "restart" || now - Date.parse(w.sent) < 10 * 60_000));
      for (const w of ws) if (!this.seen.has(w.key)) this.seen.set(w.key, now);
      const ups = start ? [] : strengthened(this.warnings, ws, now);
      this.recent = [...this.recent.filter((r) => now - r.at < 60 * 60_000), ...ups];
      this.warnings = ws;
      const urgent = [...fresh.filter(worthAnnouncing), ...ups.map((r) => r.warning).filter((w) => !fresh.some((f) => f.key === w.key))];
      if (urgent.length) {
        const queued = new Set(this.pending.map((w) => w.key));
        this.pending = [...this.pending, ...urgent.filter((w) => !queued.has(w.key))].sort((a, b) => b.rank - a.rank).slice(0, 4);
        this.interrupt?.();
      }
      this.save();
      this.overlay = { ...this.overlay, counts: countsOf(ws), outlook: outlookBadge(this.outlook), ticker: [...tickerItems(ws), ...this.reportTicker()] };
      await this.paint();
      this.retitleSoon();
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

  /** The title, in the background: the AI can take minutes to write it, and the warnings never wait for it. One at a time. */
  private retitleSoon() {
    if (this.titling) return;
    this.titling = true;
    void this.updateTitle()
      .catch((err) => log(`title: ${errText(err)}`))
      .finally(() => (this.titling = false));
  }

  /** The title: by hand (control API), else the rules' title worded by the AI when the situation changes. */
  private async updateTitle() {
    if (this.titleOverride) return this.youtube.retitle(this.titleOverride, true);
    if (!this.youtube.enabled) return;
    const basis = liveTitle(this.warnings, this.outlook, this.recent);
    const urgent = this.warnings.some((w) => w.level === "emergency");
    // Written only when YouTube would take it now (not within 10 minutes of the last title, nor over the day's
    // budget); until then it's left for a later refresh.
    if (basis !== this.aiTitle.basis && this.youtube.canRetitle(urgent)) {
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
      // A title set by hand while the AI was writing stays.
      if (this.titleOverride) return;
    }
    await this.youtube.retitle(this.aiTitle.text, urgent);
  }

  /** The data, every 30 seconds; never waits on the AI, so a new warning is never late. */
  private async watch() {
    let n = 0;
    for (;;) {
      await sleep(30_000);
      n++;
      if (n % 60 === 0) this.outlook = await fetchOutlook().catch(() => this.outlook);
      if (CONFIG.cameras && n % 60 === 30) this.cameras = await fetchCameras().catch(() => this.cameras);
      if (n % 4 === 0) await this.checkReports();
      await this.refresh();
      if (this.overlay.camera) await this.paint();
    }
  }

  /** Commentary and briefings, which can take a while to write. */
  private async talk() {
    for (;;) {
      await sleep(15_000);
      try {
        await this.maybeComment();
        await this.maybeBrief();
      } catch (err) {
        log(`commentary: ${errText(err)}`);
      }
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
    // Something came in while the scene was loading: no wait at all.
    if (this.pending.length || this.manual.length) return Promise.resolve();
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
          ? { title: "PROFESSIONAL MODE", subtitle: `Reflectivity · Velocity — ${sceneText(scene.warning).subtitle}`, color: ACCENT.pro, ends: scene.warning.ends }
          : { title: "PROFESSIONAL MODE", subtitle: `Reflectivity · Velocity — ${HOME.name}`, color: ACCENT.pro };
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
      const pro = scene.kind === "pro" || (scene.kind === "custom" && scene.mode === "professional");
      await page.waitForTimeout(pro ? 8_000 : 5_000);
      // The side panel (warnings list, tools) would cover part of the map; the overlay shows what matters.
      // Forced: a toast or loading layer over the button mustn't leave the panel up. In portrait the radar's
      // panel is the phone's bottom sheet instead, which the overlay hides: there's no button to wait for.
      if (!PORTRAIT || pro)
        await page
          .locator('button[aria-label="Hide panel"]')
          .first()
          .click({ timeout: 3_000, force: true })
          .catch(() => {});
      if (scene.kind === "national" || scene.kind === "model") {
        // The whole country: zoom out from the app's local view. Narrower in portrait, so further, and around a
        // point above the middle, which brings the country up clear of the raised lower third.
        await page.mouse.move(CONFIG.width / 2, CONFIG.height * (PORTRAIT ? 0.38 : 0.5));
        for (let i = 0; i < (PORTRAIT ? 6 : 4); i++) {
          await page.mouse.wheel(0, 360);
          await page.waitForTimeout(250);
        }
      }
      // Graphics on, then on air: the branded wipe sweeps off the finished scene.
      const camera = scene.kind === "warning" ? this.cameraFor(scene.warning) : null;
      this.overlay = { ...this.overlay, scene: this.sceneOverlay(scene), banner, camera };
      await page.evaluate(drawOverlay, this.overlay);
      // On a warning, mark the storm and where it's heading, like a presenter would.
      const marks = scene.kind === "warning" ? annotateWarning(scene.warning, Date.now()) : [];
      await page.evaluate((s) => (window as unknown as { stormcentralDraw?: (shapes: unknown) => void }).stormcentralDraw?.(s), marks).catch(() => {});
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
    const why = this.recent.find((r) => r.warning.key === w.key && Date.now() - r.at < 90_000)?.why;
    await this.show(
      { kind: "warning", warning: w, seconds: 40 },
      { kicker: why ? `UPGRADED · ${why.toUpperCase()}` : "NEW WARNING", title: w.name.toUpperCase(), places: sceneText(w).subtitle, chips: w.chips, color: w.color },
    );
    // The clip starts where the takeover went on air.
    const from = Date.now();
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

  /** A viewer's chat command: answered on screen and, within the day's budget, in chat. */
  private async onChat(m: ChatMessage) {
    const c = parseCommand(m.text);
    if (!c || !this.chatCooldowns.take(m.author, m.moderator)) return;
    if (c.cmd === "help") return this.reply(HELP);
    if (!c.arg) return this.reply(`Add a town and state, like !${c.cmd} Moore, OK`);
    const local = findPlace(c.arg, this.places);
    const place = local ? { label: `${local.name}, ${local.state}`, lat: local.lat, lon: local.lon, state: local.state } : await geocode(c.arg).catch(() => null);
    // What the viewer typed is never repeated: only a place that was found is named.
    if (!place) return this.reply(`I couldn't find that place. Try a town and state, like !${c.cmd} Moore, OK`);
    log(`chat: !${c.cmd} ${place.label}`);
    if (c.cmd === "forecast") {
      const text = forecastText(place.label, await fetchForecast(place.lat, place.lon));
      this.showCard("FORECAST · ASKED IN CHAT", place.label, text.slice(place.label.length + 2), ACCENT.national);
      return this.reply(text);
    }
    if (c.cmd === "alerts") {
      const text = alertsText(place.label, place.state, await fetchAlerts(place.lat, place.lon, UA));
      this.showCard("ALERTS · ASKED IN CHAT", place.label, text.slice(place.label.length + 2), ACCENT.model);
      return this.reply(text);
    }
    // !radar: a viewer's place on the stream for 45 seconds; moderators any time, viewers when no major tornado
    // is on and nobody else's place was shown in the last 5 minutes.
    const top = this.warnings[0];
    if (!m.moderator && top && isMajor(top)) return this.reply("We're staying on the tornado right now. Try !radar again once it's over.");
    if (!m.moderator && Date.now() - this.viewerRadarAt < 5 * 60_000) return this.reply("Another viewer's place was just on. Try !radar again in a few minutes.");
    this.viewerRadarAt = Date.now();
    this.manual.push({ kind: "custom", lat: place.lat, lon: place.lon, name: place.label, mode: "severe", seconds: 45 });
    // With no warnings it cuts in now; with warnings it waits for the next scene.
    if (!this.warnings.length) this.interrupt?.();
    return this.reply(`Showing ${place.label} on the stream ${this.warnings.length ? "next" : "now"}.`);
  }

  private async reply(text: string) {
    const chatId = await this.youtube.chatId();
    if (!chatId || !this.chatReplies.take()) return;
    await postChat(chatId, text, await this.youtube.auth()).catch((err) => log(`chat reply: ${errText(err)}`));
  }

  /** An answer on screen for 15 seconds. */
  private showCard(kicker: string, title: string, text: string, color: string) {
    if (this.cardTimer) clearTimeout(this.cardTimer);
    this.overlay = { ...this.overlay, card: { kicker, title, text: text.charAt(0).toUpperCase() + text.slice(1), color } };
    void this.paint();
    this.cardTimer = setTimeout(() => {
      this.overlay = { ...this.overlay, card: null };
      void this.paint();
    }, 15_000);
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
        void this.updateTitle().catch((err) => log(`title: ${errText(err)}`));
      },
    };
  }
}

async function main() {
  mkdirSync(CONFIG.tmp, { recursive: true });
  // A persistent profile, because only then does Chromium open its window with --kiosk (no tabs or address bar).
  // Always the same folder, emptied first: a new one per start left a whole profile behind on every restart.
  rmSync(CONFIG.profile, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(CONFIG.profile, {
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
  await context.addInitScript((light: boolean) => {
    // Dark, imperial, Professional mode on, and observed radar only (no model forecast or extrapolated
    // frames), except in the HRRR scene, which asks for the model's frames with ?scl_future=1.
    // Only what the stream is about: radar, warnings and watches, and storm reports. Every other layer
    // (lightning, cells and tracks, radar sites, cameras, advisories...) is more for Chromium to draw on
    // the CPU, and more clutter on a TV-sized picture.
    const future = new URLSearchParams(location.search).get("scl_future") === "1";
    const radar = {
      future,
      nowcast: false,
      // Light: each loop step is one redraw instead of a fade's worth.
      crossfade: !light,
      alertKinds: ["warning", "watch"],
      showReports: false,
      showCells: false,
      showTracks: false,
      showSites: false,
      showLightning: false,
      showTropical: false,
      showSpotterWarnings: false,
      showChasers: false,
      showCams: false,
      intlRadar: false,
      intlAlerts: false,
    };
    localStorage.setItem("stormcentral:v1", JSON.stringify({ state: { professional: true, theme: "dark", units: "imperial", radar }, version: 1 }));
    // The basemap without what a radar picture doesn't need: minor roads, buildings, land cover, and labels
    // other than places (each label is placed again whenever the map moves).
    const style = { roads: "major", buildings: false, landcover: false, roadLabels: false, poiLabels: false };
    localStorage.setItem("stormcentral:map-style:v1", JSON.stringify({ state: { style }, version: 1 }));
    // Professional mode: reflectivity and velocity side by side (two maps, not four), 6-scan loops.
    localStorage.setItem("stormcentral:pro", JSON.stringify({ state: { layout: "1x2", frames: 6, speed: 1 }, version: 1 }));
  }, CONFIG.light);
  await context.addInitScript(paceFrames, CONFIG.fps);
  // MapLibre sizes its drawing to devicePixelRatio; the page's own text and graphics don't read it.
  if (CONFIG.mapScale < 1)
    await context.addInitScript((scale) => Object.defineProperty(window, "devicePixelRatio", { get: () => scale, configurable: true }), CONFIG.mapScale);
  const director = new Director(context);
  context.on("close", () => {
    director.closed = true;
    log("Chromium closed; exiting so systemd restarts the stream.");
    process.exit(1);
  });
  log(`Live stream director: ${CONFIG.app}, ${CONFIG.width}x${CONFIG.height}, YouTube titles and clips ${credentialsFromEnv(env) ? "on" : "off (no YT_* credentials)"}.`);
  await director.start();
}

// A side task that fails (a title, a clip, a camera) is logged; it never takes the stream down.
process.on("unhandledRejection", (err) => log(`unhandled: ${errText(err)}`));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
