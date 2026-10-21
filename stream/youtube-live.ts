/**
 * The live stream on YouTube: retitling the broadcast as storms change, and
 * cutting clips of warnings from the rolling recording (run.sh) into Shorts.
 * Both need YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN with the
 * youtube scope, and stay within daily budgets of YouTube's API quota (a
 * title change costs ~51 of the 10,000 daily units, an upload 1,600 shared
 * with the Shorts workflow).
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { accessToken, liveBroadcast, setVideoTitle, uploadVideo, type YouTubeCredentials } from "../shorts/youtube";
import { clipText, sceneText, type StreamWarning } from "./plan";

const run = promisify(execFile);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** YouTube's quota day runs on Pacific time. */
const quotaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(Date.now());

/** A file path as a filtergraph option value. */
const pathValue = (p: string) => `'${p.replace(/[\\:']/g, (c) => `\\${c}`)}'`;

/** drawtext's font option for a fontconfig pattern: the file itself, so the style is exact. */
async function fontFile(pattern: string) {
  const { stdout } = await run("fc-match", ["-f", "%{file}", pattern]).catch(() => ({ stdout: "" }));
  return stdout ? `fontfile=${pathValue(stdout)}` : "font=Inter";
}

/** How much of a budget is used on its quota day, saved across restarts. */
export interface BudgetState {
  day: string;
  used: number;
}

/** A daily allowance, counted on YouTube's quota day. */
export class Budget {
  private day = quotaDay();
  private used = 0;
  /** `onTake` runs after each one taken (the director saves the counts then, so a restart doesn't start the day over). */
  constructor(
    private max: number,
    private onTake: () => void = () => {},
  ) {}
  take(): boolean {
    if (this.day !== quotaDay()) [this.day, this.used] = [quotaDay(), 0];
    if (this.used >= this.max) return false;
    this.used++;
    this.onTake();
    return true;
  }
  /** Whether there's one left today, without taking it. */
  get left(): boolean {
    return (this.day === quotaDay() ? this.used : 0) < this.max;
  }
  get state(): BudgetState {
    return { day: this.day, used: this.used };
  }
  /** Carries on from a count saved earlier the same quota day (one from an earlier day is ignored). */
  restore(saved: BudgetState | undefined) {
    if (saved?.day === quotaDay() && Number.isFinite(saved.used) && saved.used > this.used) [this.day, this.used] = [saved.day, saved.used];
  }
}

export interface YouTubeLiveOptions {
  credentials: YouTubeCredentials | null;
  titlesPerDay: number;
  clipsPerDay: number;
  /** The rolling recording's pieces (run.sh). */
  segments: string;
  tmp: string;
  privacy: string;
  /** Tests: render clips to this file and don't post them. */
  dryRunClip?: string;
  /** This stream's key: with two streams on air (the vertical one too), the broadcast it feeds is the one to title and chat in. */
  streamKey?: string;
  /** Runs when a title or a clip is counted against the day's budget (to save the counts). */
  onBudget?: () => void;
  log: (msg: string) => void;
}

export class YouTubeLive {
  private token: { value: string; at: number } | null = null;
  private live: { id: string | null; chatId: string | null; at: number } = { id: null, chatId: null, at: 0 };
  title = "";
  private titledAt = 0;
  readonly titles: Budget;
  readonly clips: Budget;

  constructor(private o: YouTubeLiveOptions) {
    this.titles = new Budget(o.titlesPerDay, o.onBudget);
    this.clips = new Budget(o.clipsPerDay, o.onBudget);
  }

  get enabled() {
    return !!this.o.credentials;
  }

  async auth() {
    if (!this.token || Date.now() - this.token.at > 45 * 60_000) this.token = { value: await accessToken(this.o.credentials!), at: Date.now() };
    return this.token.value;
  }

  /** The live broadcast (looked up every 10 minutes, sooner while there's none: a restart starts a new one). */
  private async broadcast() {
    if (this.enabled && Date.now() - this.live.at > (this.live.id ? 10 : 2) * 60_000) {
      let b: Awaited<ReturnType<typeof liveBroadcast>> = null;
      try {
        b = await liveBroadcast(await this.auth(), this.o.streamKey);
      } catch (err) {
        this.o.log(`couldn't find the live broadcast: ${errText(err)}`);
      }
      this.live = { id: b?.id ?? null, chatId: b?.chatId ?? null, at: Date.now() };
    }
    return this.live;
  }

  /** The live broadcast's video id. */
  async liveId(): Promise<string | null> {
    return (await this.broadcast()).id;
  }

  /** The live broadcast's chat id. */
  async chatId(): Promise<string | null> {
    return (await this.broadcast()).chatId;
  }

  /** Whether a new title would be set now: at most every 10 minutes (urgent ones at once), within the day's budget. */
  canRetitle(urgent: boolean) {
    return this.enabled && (urgent || Date.now() - this.titledAt >= 10 * 60_000) && this.titles.left;
  }

  /** Sets the title when it says something new and canRetitle allows it. */
  async retitle(title: string, urgent: boolean) {
    if (title === this.title || !this.canRetitle(urgent)) return;
    const id = await this.liveId();
    if (!id || !this.titles.take()) return;
    // Counted as an attempt either way, so a title YouTube keeps refusing isn't retried every 30 seconds.
    this.titledAt = Date.now();
    try {
      await setVideoTitle(id, title, await this.auth());
      this.title = title;
      this.o.log(`title: ${title}`);
    } catch (err) {
      this.o.log(`couldn't change the title: ${errText(err)}`);
    }
  }

  /**
   * Cuts the stream from a few seconds before `from` to `to` out of the rolling
   * recording, makes it vertical with the warning on top, and posts it as a Short.
   */
  async clip(w: StreamWarning, from: number, to: number) {
    const dry = this.o.dryRunClip;
    // None allowed (the vertical stream leaves clips to the main one): nothing to read or cut.
    if ((!this.enabled && !dry) || !this.o.segments || (!dry && !this.clips.left)) return;
    let dir: string | null = null;
    try {
      const segs = readdirSync(this.o.segments)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => ({ f: join(this.o.segments, f), t: statSync(join(this.o.segments, f)).mtimeMs }))
        // A piece's time is when it ended: the first one kept holds the cut-in.
        .filter((s) => s.t >= from && s.t <= to + 8_000)
        .sort((a, b) => a.t - b.t);
      if (segs.length < 3) return this.o.log("clip: not enough of the recording yet");
      if (!this.clips.take()) return this.o.log("clip: today's clips are used up");
      // A folder per clip: two warnings close together render side by side without sharing files.
      dir = mkdtempSync(join(this.o.tmp, "clip-"));
      const list = join(dir, "list.txt"), raw = join(dir, "raw.ts"), out = join(dir, "clip.mp4");
      writeFileSync(list, segs.map((s) => `file '${s.f}'`).join("\n"));
      await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", raw], { timeout: 120_000 });
      const { title, subtitle } = sceneText(w);
      const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
      // Text from files, read as written: names like O'Brien County need no escaping.
      let n = 0;
      const text = (s: string) => {
        const file = join(dir!, `text${n++}.txt`);
        writeFileSync(file, s);
        return `textfile=${pathValue(file)}:expansion=none`;
      };
      const [black, bold] = await Promise.all([fontFile("Inter:style=Black"), fontFile("Inter:style=Bold")]);
      // The subtitle's parts ("Cleveland and McClain Counties, OK", "until 11:46 PM CDT") on lines of their own.
      const lines = subtitle.split(" · ").slice(0, 3).map((l) => fit(l, 42));
      // 1080x1920: the stream, blurred, behind itself at full width; the warning above, the channel below.
      const vf = [
        "[0:v]split[a][b]",
        "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.22[bg]",
        "[b]scale=1080:-2[fg]",
        "[bg][fg]overlay=(W-w)/2:(H-h)/2+40",
        `drawtext=${black}:${text(fit(title, 22))}:fontcolor=${w.color}:fontsize=80:x=(w-text_w)/2:y=300:borderw=4:bordercolor=black@0.6`,
        ...lines.map((l, i) => `drawtext=${bold}:${text(l)}:fontcolor=white:fontsize=42:x=(w-text_w)/2:y=${410 + i * 58}:borderw=3:bordercolor=black@0.6`),
        `drawtext=${bold}:${text("LIVE 24/7 · STORM CENTRAL")}:fontcolor=white@0.9:fontsize=44:x=(w-text_w)/2:y=1530`,
      ].join(",");
      await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-filter_complex", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-t", "58", "-movflags", "+faststart", out], { timeout: 600_000 });
      if (dry) {
        await run("cp", [out, dry]);
        return this.o.log(`clip rendered (not posted): ${dry}`);
      }
      const live = await this.liveId();
      const meta = clipText(w, live ? `https://youtu.be/${live}` : null);
      const id = await uploadVideo(out, { ...meta, privacy: this.o.privacy }, await this.auth());
      this.o.log(`clip posted: https://youtube.com/shorts/${id}`);
    } catch (err) {
      this.o.log(`clip failed: ${errText(err)}`);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}
