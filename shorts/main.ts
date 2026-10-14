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
 *
 * Environment:
 *   SHORTS_KIND            which kind to make (default outlook)
 *   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN  YouTube credentials (missing → render only)
 *   SHORTS_UPLOAD=1        upload the videos (otherwise they're only rendered)
 *   SHORTS_PRIVACY         public (default), unlisted or private
 *   SHORTS_PLAYLISTS=false don't add videos to playlists
 *   SHORTS_WAIT_MIN        outlook: minutes to wait for today's morning outlook (default 50)
 *   SHORTS_LATEST=1        outlook: the latest Day 1 outlook, whatever its time; recap: post even on a quiet day
 *   SHORTS_SKIP_QUIET=true outlook: no video on days without a severe risk
 *   SHORTS_VOICE=false     no narrator (otherwise edge-tts reads a script timed to the scenes; see voice.ts)
 *   SHORTS_VOICE_NAME      the narrator's voice (default en-US-AndrewNeural)
 *   SHORTS_TROPICAL_MAX    tropical: at most this many storms (default 2, strongest first)
 *   SHORTS_OUT_DIR         where the MP4s and their metadata go (default shorts/out)
 *   SHORTS_FIXTURES        a folder of saved source files to use instead of fetching (testing)
 *   SHORTS_SAVE            a folder to save the fetched source files into (to make fixtures)
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outlookKind } from "./kinds/outlook";
import { recapKind } from "./kinds/recap";
import { tropicalKind } from "./kinds/tropical";
import { weeklyKind } from "./kinds/weekly";
import { narration } from "./narration";
import { renderShort } from "./render";
import type { Kind, Video } from "./video";
import { addVoice, DEFAULT_VOICE } from "./voice";
import { accessToken, addToPlaylist, credentialsFromEnv, uploadVideo, YouTubeError, type VideoMeta } from "./youtube";

const env = process.env;
const KINDS: Record<string, Kind> = { outlook: outlookKind, recap: recapKind, weekly: weeklyKind, tropical: tropicalKind };
const PLAYLIST_ABOUT: Record<string, string> = {
  "Daily Severe Weather Outlook": "Every morning: the day's severe weather outlook from NOAA's Storm Prediction Center, on a map.",
  "Storm Reports": "On active severe weather days: the day's tornado, wind and hail reports from the National Weather Service.",
  "Severe Weather: Week Ahead": "Every Sunday: the severe weather outlook for the next eight days.",
  "Tropical Updates": "Hurricane and tropical storm updates from the National Hurricane Center, while storms are active.",
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
    writeFileSync(join(outDir, `${v.key}.json`), JSON.stringify({ ...meta, playlist: v.playlist }, null, 2));
    console.log(`\n── ${v.key} ──\nTitle: ${v.title}\nTítulo: ${v.es.title}\n\n${v.description}\n`);
    const started = Date.now();
    await renderShort(v.template, v.data, out);
    console.log(`Rendered ${out} in ${Math.round((Date.now() - started) / 1000)} s.`);
    if (env.SHORTS_VOICE !== "false") {
      // A narrator is nice to have: when the voice service is down, the Short still goes up, silent.
      await addVoice(out, narration(v), env.SHORTS_VOICE_NAME || DEFAULT_VOICE).then(
        () => console.log("Added the narration."),
        (err: unknown) => console.warn(`::warning::No narration for ${v.key}: ${err instanceof Error ? err.message : err}`),
      );
    }
    if (!token) continue;

    // One video failing to upload doesn't stop the others (two storms, say); the run still fails at the end.
    try {
      const id = await uploadVideo(out, meta, token);
      uploaded++;
      console.log(`Uploaded → https://youtube.com/shorts/${id}`);
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

  if (uploaded) setOutput("uploaded", "true");
  if (!token) console.log(creds ? "\nNot uploading (SHORTS_UPLOAD isn't 1)." : "\nNo YouTube credentials; rendered only.");
  if (failed) throw failed;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
