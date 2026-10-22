/**
 * Makes the Storm Central Shorts: one kind per run (SHORTS_KIND), each giving
 * zero or more videos, drawn (render.ts) and uploaded to YouTube (youtube.ts)
 * with a Spanish localization and into the kind's playlist. GitHub Actions
 * runs each kind on its own schedule (.github/workflows/youtube-shorts.yml);
 * see shorts/README.md.
 *
 * Kinds (kinds/*.ts):
 *   outlook   the morning severe weather outlook (every day)
 *   recap     the evening storm report recap (active days only)
 *   weekly    the next eight days of outlooks (Sundays)
 *   tropical  an update for each named storm (while there are any)
 *   fire      the most significant active wildfire (when one is big, growing or far from contained)
 *   lesson    Radar School: a full-length (16:9) lesson on reading radar (Wednesdays)
 *   seasonal  NOAA's three-month temperature and precipitation outlook (the third Thursday of each month)
 *   breaking  a Tornado or Flash Flood Emergency, Extreme Wind Warning, PDS tornado warning or watch, or SPC High Risk
 *             (checked every 10 minutes by .github/workflows/youtube-breaking.yml)
 *
 * Environment:
 *   SHORTS_KIND            which kind to make (default outlook)
 *   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN  YouTube credentials (missing → render only)
 *   SHORTS_UPLOAD=1        upload the videos (otherwise they're only rendered)
 *   SHORTS_PRIVACY         public (default), unlisted or private
 *   SHORTS_PLAYLISTS=false don't add videos to playlists
 *   SHORTS_WAIT_MIN        outlook: minutes to wait for today's morning outlook (default 50)
 *   SHORTS_LATEST=1        outlook: the latest Day 1 outlook, whatever its time; recap: post even on a quiet day;
 *                          seasonal: the latest outlook, however old
 *   SHORTS_SKIP_QUIET=true outlook: no video on days without a severe risk
 *   SHORTS_VOICE=false     no narrator (otherwise edge-tts reads a script timed to the scenes; see voice.ts)
 *   SHORTS_VOICE_NAME      the narrator's voice (default en-US-AndrewNeural)
 *   SHORTS_AI=true         livelier narration: a model rewrites the script, every line checked against the facts (script.ts)
 *   ANTHROPIC_API_KEY      the model is Claude (SHORTS_CLAUDE_MODEL, default claude-haiku-5-5) instead of Ollama
 *   SHORTS_AI_MODEL        the Ollama model, without a Claude key (default gemma3:12b)
 *   OLLAMA_HOST            where Ollama listens (default 127.0.0.1:11434)
 *   SHORTS_AI_COMPARE=1    also save each video with the plain narration, as <key>-plain.mp4
 *   SHORTS_TROPICAL_MAX    tropical: at most this many storms (default 2, strongest first)
 *   SHORTS_FIRE_MAX        fire: at most this many fires (default 1)
 *   SHORTS_BREAKING_MAX    breaking: at most this many events per run (default 1)
 *   SHORTS_BREAKING_DAILY_MAX  breaking: at most this many a day (default 2; YouTube's quota allows about 6 uploads)
 *   SHORTS_BREAKING_EVENT  breaking: the event key to make first (from breaking-check.ts)
 *   SHORTS_LESSON          lesson: which lesson (number or id) instead of this week's
 *   SHORTS_STATE_DIR       fire, breaking: where yesterday's fire sizes and the posted events are kept (default shorts/.state)
 *   SHORTS_OUT_DIR         where the MP4s and their metadata go (default shorts/out)
 *   SHORTS_FIXTURES        a folder of saved source files to use instead of fetching (testing)
 *   SHORTS_SAVE            a folder to save the fetched source files into (to make fixtures)
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { breakingKind } from "./kinds/breaking";
import { fireKind } from "./kinds/fire";
import { lessonKind } from "./kinds/lesson";
import { outlookKind } from "./kinds/outlook";
import { recapKind } from "./kinds/recap";
import { seasonalKind } from "./kinds/seasonal";
import { tropicalKind } from "./kinds/tropical";
import { weeklyKind } from "./kinds/weekly";
import { narration, type Cue } from "./narration";
import { renderShort, renderStill } from "./render";
import { livelyNarration } from "./script";
import type { Kind, Video } from "./video";
import { addVoice, DEFAULT_VOICE, seconds } from "./voice";
import { accessToken, addToPlaylist, credentialsFromEnv, setThumbnail, uploadVideo, YouTubeError, type VideoMeta } from "./youtube";

const env = process.env;
const KINDS: Record<string, Kind> = { outlook: outlookKind, recap: recapKind, weekly: weeklyKind, tropical: tropicalKind, fire: fireKind, breaking: breakingKind, lesson: lessonKind, seasonal: seasonalKind };
const PLAYLIST_ABOUT: Record<string, string> = {
  "Daily Severe Weather Outlook": "Every morning: the day's severe weather outlook from NOAA's Storm Prediction Center, on a map.",
  "Storm Reports": "On active severe weather days: the day's tornado, wind and hail reports from the National Weather Service.",
  "Severe Weather: Week Ahead": "Every Sunday: the severe weather outlook for the next eight days.",
  "Tropical Updates": "Hurricane and tropical storm updates from the National Hurricane Center, while storms are active.",
  "Wildfire Updates": "Updates on significant US wildfires from the National Interagency Fire Center: size, growth and containment.",
  "Seasonal Outlooks":
    "Every month: NOAA's outlook for the next three months, where a warmer, colder, wetter or drier than normal season is more likely, from the Climate Prediction Center.",
  "Radar School": "A free weekly series on reading weather radar: how it works, the colors, velocity, hook echoes, debris signatures and more, with simulated radar examples.",
  "Breaking Severe Weather":
    "Tornado and flash flood emergencies, PDS tornado warnings and watches, and High Risk days, as they're issued. Not an official warning source; follow the National Weather Service.",
};

function setOutput(name: string, value: string) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function metaOf(v: Video): VideoMeta {
  return {
    title: v.title,
    description: v.description,
    tags: v.tags,
    privacy: ["public", "unlisted", "private"].includes(env.SHORTS_PRIVACY ?? "") ? env.SHORTS_PRIVACY! : "public",
    localizations: { es: v.es },
  };
}

async function main() {
  const kind = (env.SHORTS_KIND || "outlook").trim().toLowerCase();
  const make = KINDS[kind];
  if (!make) throw new Error(`Unknown SHORTS_KIND "${kind}" (${Object.keys(KINDS).join(", ")})`);
  const outDir = env.SHORTS_OUT_DIR || "shorts/out";
  mkdirSync(outDir, { recursive: true });

  const videos = await make({ env, fixtures: env.SHORTS_FIXTURES || undefined, save: env.SHORTS_SAVE || undefined });
  if (!videos.length) return console.log(`No ${kind} video this time.`);

  const creds = credentialsFromEnv();
  const upload = env.SHORTS_UPLOAD === "1" && !!creds;
  const token = upload ? await accessToken(creds!) : null;
  let uploaded = 0;
  let failed: unknown = null;

  for (const v of videos) {
    const out = join(outDir, `${v.key}.mp4`);
    const meta = metaOf(v);
    const saveMeta = (said?: Cue[]) =>
      writeFileSync(join(outDir, `${v.key}.json`), JSON.stringify({ ...meta, playlist: v.playlist, ...(said ? { narration: said } : {}) }, null, 2));
    saveMeta();
    console.log(`\n── ${v.key} ──\nTitle: ${v.title}\nTítulo: ${v.es.title}\n\n${v.description}\n`);
    const started = Date.now();
    // One video failing to render doesn't stop the others either; the run still fails at the end.
    try {
      await renderShort(v.template, v.data, out, v.size ?? {});
    } catch (err) {
      console.error(`Rendering ${v.key} failed: ${err instanceof Error ? err.message : err}`);
      failed = err;
      continue;
    }
    console.log(`Rendered ${out} in ${Math.round((Date.now() - started) / 1000)} s.`);
    // Full-length videos get their own thumbnail (kept with the video, so a test run shows it too).
    const thumb = v.thumbnailAt != null ? join(outDir, `${v.key}-thumbnail.jpg`) : null;
    if (thumb) await renderStill(v.template, v.data, v.thumbnailAt!, thumb, v.size ?? {}).catch((err: unknown) => console.warn(`::warning::No thumbnail: ${err instanceof Error ? err.message : err}`));
    if (env.SHORTS_VOICE !== "false") {
      const voice = env.SHORTS_VOICE_NAME || DEFAULT_VOICE;
      const plain = narration(v);
      let cues = plain;
      // Breaking news reads the warning's facts as written (no AI rewording of life-threatening warnings),
      // and Radar School its hand-checked lesson script.
      if (env.SHORTS_AI === "true" && plain.length && v.template !== "breaking.html" && v.template !== "lesson.html") {
        const writer = { anthropicKey: env.ANTHROPIC_API_KEY || undefined, claudeModel: env.SHORTS_CLAUDE_MODEL || undefined, host: env.OLLAMA_HOST, model: env.SHORTS_AI_MODEL || undefined };
        cues = await livelyNarration(v, plain, await seconds(out), writer).catch((err: unknown) => {
          console.warn(`::warning::The AI narrator failed; using the plain script: ${err instanceof Error ? err.message : err}`);
          return plain;
        });
        if (env.SHORTS_AI_COMPARE === "1") {
          const other = join(outDir, `${v.key}-plain.mp4`);
          copyFileSync(out, other);
          await addVoice(other, plain, voice).catch((err: unknown) => console.warn(`::warning::No plain narration for ${v.key}: ${err instanceof Error ? err.message : err}`));
        }
      }
      // A narrator is nice to have: when the voice service is down, the Short still goes up, silent.
      await addVoice(out, cues, voice).then(
        (said) => {
          console.log("Added the narration.");
          saveMeta(said);
        },
        (err: unknown) => console.warn(`::warning::No narration for ${v.key}: ${err instanceof Error ? err.message : err}`),
      );
    }
    if (!token) continue;

    // One video failing to upload doesn't stop the others (two storms, say); the run still fails at the end.
    try {
      const id = await uploadVideo(out, meta, token);
      // Recorded at once for the posted marker: whatever goes wrong later in the run, a backup run mustn't post it again.
      if (!uploaded++) setOutput("uploaded", "true");
      console.log(v.size ? `Uploaded → https://youtu.be/${id}` : `Uploaded → https://youtube.com/shorts/${id}`);
      if (thumb && existsSync(thumb)) {
        await setThumbnail(id, thumb, token).then(
            () => console.log("Set the thumbnail."),
            (err: unknown) =>
              console.warn(
                `::warning::Couldn't set the thumbnail: ${err instanceof Error ? err.message : err}` +
                  (err instanceof YouTubeError && err.status === 403 ? " (custom thumbnails need a verified channel: youtube.com/verify)" : ""),
              ),
          );
      }
      if (env.SHORTS_PLAYLISTS !== "false") {
        await addToPlaylist(id, v.playlist, PLAYLIST_ABOUT[v.playlist] ?? "", token).then(
          () => console.log(`Added to the playlist "${v.playlist}".`),
          (err: unknown) => {
            const scope = err instanceof YouTubeError && err.status === 403;
            console.warn(
              `::warning::Couldn't add the video to "${v.playlist}": ${err instanceof Error ? err.message : err}` +
                (scope ? " (the refresh token needs the https://www.googleapis.com/auth/youtube scope for playlists; see shorts/README.md)" : ""),
            );
          },
        );
      }
    } catch (err) {
      console.error(`Uploading ${v.key} failed: ${err instanceof Error ? err.message : err}`);
      failed = err;
    }
  }

  if (!token) console.log(creds ? "\nNot uploading (SHORTS_UPLOAD isn't 1)." : "\nNo YouTube credentials; rendered only.");
  if (failed) throw failed;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
