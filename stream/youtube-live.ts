/**
 * The live stream on YouTube: retitling the broadcast as storms change, and
 * cutting clips of warnings from the rolling recording (run.sh) into Shorts.
 * Both need YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN with the
 * youtube scope, and stay within daily budgets of YouTube's API quota (a
 * title change costs ~51 of the 10,000 daily units, an upload 1,600 shared
 * with the Shorts workflow).
 */
import { execFile } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { accessToken, liveVideoId, setVideoTitle, uploadVideo, type YouTubeCredentials } from "../shorts/youtube";
import { clipText, sceneText, type StreamWarning } from "./plan";

const run = promisify(execFile);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** YouTube's quota day runs on Pacific time. */
const quotaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(Date.now());

/** A daily allowance, counted on YouTube's quota day. */
export class Budget {
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
  log: (msg: string) => void;
}

export class YouTubeLive {
  private token: { value: string; at: number } | null = null;
  private live: { id: string | null; at: number } = { id: null, at: 0 };
  title = "";
  private titledAt = 0;
  private titles: Budget;
  private clips: Budget;

  constructor(private o: YouTubeLiveOptions) {
    this.titles = new Budget(o.titlesPerDay);
    this.clips = new Budget(o.clipsPerDay);
  }

  get enabled() {
    return !!this.o.credentials;
  }

  private async auth() {
    if (!this.token || Date.now() - this.token.at > 45 * 60_000) this.token = { value: await accessToken(this.o.credentials!), at: Date.now() };
    return this.token.value;
  }

  /** The live broadcast's id (looked up every 10 minutes: a restart starts a new broadcast). */
  async liveId(): Promise<string | null> {
    if (!this.enabled) return null;
    if (Date.now() - this.live.at > 10 * 60_000) this.live = { id: await liveVideoId(await this.auth()).catch(() => null), at: Date.now() };
    return this.live.id;
  }

  /** Sets the title when it says something new: at most every 10 minutes (urgent ones at once), within the day's budget. */
  async retitle(title: string, urgent: boolean) {
    if (!this.enabled || title === this.title || (!urgent && Date.now() - this.titledAt < 10 * 60_000)) return;
    const id = await this.liveId();
    if (!id || !this.titles.take()) return;
    try {
      await setVideoTitle(id, title, await this.auth());
      [this.title, this.titledAt] = [title, Date.now()];
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
    if ((!this.enabled && !dry) || !this.o.segments) return;
    try {
      const segs = readdirSync(this.o.segments)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => ({ f: join(this.o.segments, f), t: statSync(join(this.o.segments, f)).mtimeMs }))
        .filter((s) => s.t >= from - 4_000 && s.t <= to + 8_000)
        .sort((a, b) => a.t - b.t);
      if (segs.length < 3) return this.o.log("clip: not enough of the recording yet");
      if (!this.clips.take()) return this.o.log("clip: today's clips are used up");
      const list = join(this.o.tmp, "clip.txt"), raw = join(this.o.tmp, "clip-raw.ts"), out = join(this.o.tmp, "clip.mp4");
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
        return this.o.log(`clip rendered (not posted): ${dry}`);
      }
      const live = await this.liveId();
      const meta = clipText(w, live ? `https://youtu.be/${live}` : null);
      const id = await uploadVideo(out, { ...meta, privacy: this.o.privacy }, await this.auth());
      this.o.log(`clip posted: https://youtube.com/shorts/${id}`);
    } catch (err) {
      this.o.log(`clip failed: ${errText(err)}`);
    }
  }
}
