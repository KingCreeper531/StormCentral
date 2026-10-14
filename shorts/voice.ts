/**
 * Gives a rendered Short its narrator: speaks each cue (narration.ts) with a
 * Microsoft neural voice through edge-tts (Andrew by default; no key needed),
 * lays the lines on the video's timeline and mixes them in at YouTube's
 * loudness.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Cue } from "./narration";

const run = promisify(execFile);
export const DEFAULT_VOICE = "en-US-AndrewNeural";
/** Silence kept between two lines when the first runs past the second's start. */
const GAP = 0.25;

const seconds = async (file: string) =>
  Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).stdout.trim());

async function speak(text: string, voice: string, out: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await run("edge-tts", ["--voice", voice, "--text", text, "--write-media", out], { timeout: 60_000 });
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
}

/** When each line starts: at its cue, or just after the line before it ends, whichever is later. */
export function layout(cues: Cue[], lengths: number[]): number[] {
  let end = 0;
  return cues.map((c, i) => {
    const start = Math.max(c.at, i ? end + GAP : 0);
    end = start + lengths[i]!;
    return start;
  });
}

/** Adds the narration to `video` in place. */
export async function addVoice(video: string, cues: Cue[], voice = DEFAULT_VOICE): Promise<void> {
  if (!cues.length) return;
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    const files = cues.map((_, i) => join(dir, `${i}.mp3`));
    for (const [i, c] of cues.entries()) await speak(c.text, voice, files[i]!);
    const lengths = await Promise.all(files.map(seconds));
    const total = await seconds(video);
    const starts = layout(cues, lengths);
    starts.forEach((s, i) => {
      const line = `${s.toFixed(1)}–${(s + lengths[i]!).toFixed(1)} s  ${cues[i]!.text}`;
      console.log(s + lengths[i]! > total ? `::warning::Cut off at the end: ${line}` : `  ${line}`);
    });

    const delays = starts.map((s, i) => `[${i + 1}:a]adelay=delays=${Math.round(s * 1000)}:all=1[a${i}]`);
    const mix = `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad[voice]`;
    const tmp = join(dir, "out.mp4");
    await run("ffmpeg", [
      "-v", "error", "-y", "-i", video, ...files.flatMap((f) => ["-i", f]),
      "-filter_complex", [...delays, mix].join(";"),
      "-map", "0:v", "-map", "[voice]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(total), "-movflags", "+faststart", tmp,
    ]);
    renameSync(tmp, video);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
