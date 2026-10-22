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

export const seconds = async (file: string) =>
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

/** Shorter than this (seconds) can't be the whole line read aloud: about a third of the narrator's pace. */
export const tooShort = (text: string) => text.split(/\s+/).filter(Boolean).length * 0.12;

/** When each line starts: at its cue, or just after the line before it ends, whichever is later. */
export function layout(cues: Cue[], lengths: number[]): number[] {
  let end = 0;
  return cues.map((c, i) => {
    const start = Math.max(c.at, i ? end + GAP : 0);
    end = start + lengths[i]!;
    return start;
  });
}

/**
 * Which rewritten line (script.ts) to put back to its plain wording when the
 * narration runs past the end: the one that overruns its slot the most, or -1
 * when it all fits or nothing is left to swap.
 */
export function longestRewrite(cues: Cue[], lengths: number[], total: number): number {
  const starts = layout(cues, lengths);
  if (starts.every((s, i) => s + lengths[i]! <= total)) return -1;
  let worst = -1;
  let over = -Infinity;
  cues.forEach((c, i) => {
    const slot = (cues[i + 1]?.at ?? total) - c.at;
    if (c.plain && lengths[i]! - slot > over) [worst, over] = [i, lengths[i]! - slot];
  });
  return worst;
}

/** Adds the narration to `video` in place; returns the lines as read (a rewrite that didn't fit is back to its plain line). */
export async function addVoice(video: string, lines: Cue[], voice = DEFAULT_VOICE): Promise<Cue[]> {
  if (!lines.length) return lines;
  const cues = [...lines];
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    const files = cues.map((_, i) => join(dir, `${i}.mp3`));
    for (const [i, c] of cues.entries()) await speak(c.text, voice, files[i]!);
    const lengths = await Promise.all(files.map(seconds));
    // The voice service now and then sends back a clip of a fraction of a second for a whole line (the Winter
    // Outlook test lost one that way): say it again.
    for (const [i, c] of cues.entries()) {
      for (let tries = 0; lengths[i]! < tooShort(c.text) && tries < 2; tries++) {
        console.log(`  The voice came back ${lengths[i]!.toFixed(1)} s long; again: ${c.text}`);
        await speak(c.text, voice, files[i]!);
        lengths[i] = await seconds(files[i]!);
      }
    }
    const total = await seconds(video);
    for (let i = longestRewrite(cues, lengths, total); i >= 0; i = longestRewrite(cues, lengths, total)) {
      console.log(`  Too long to fit; back to the plain line: ${cues[i]!.text}`);
      cues[i] = { at: cues[i]!.at, text: cues[i]!.plain! };
      await speak(cues[i]!.text, voice, files[i]!);
      lengths[i] = await seconds(files[i]!);
    }
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
    return cues;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
