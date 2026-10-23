/**
 * Posts new warnings to the Storm Central Facebook Page (warning-posts.ts
 * says which and what), run every few minutes by
 * .github/workflows/facebook-warnings.yml with the posted ones kept in the
 * Actions cache.
 *
 *   node facebook-warnings.mjs          post what's new (FB_PAGE_TOKEN, FB_POSTS_PER_HOUR, FB_SEVERE), each with its picture
 *                                       (warning-card.ts: the polygon on radar; FB_CARDS=false for text and a link only)
 *   node facebook-warnings.mjs plan     only count what's due (GitHub output "due"), so Chromium is installed only then
 *   node facebook-warnings.mjs check    test the token: find its Page, make a hidden post and delete it
 *   FB_DRY_RUN=1                        print the posts and save their pictures in FB_OUT_DIR (default shorts/out) instead of posting
 *
 * FB_STATE_DIR is where the posted warnings are kept (default shorts/.state).
 */
import type { RawAlertFeature } from "../src/lib/alerts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deletePost, pageFromEnv, postPhoto, postToPage, resolvePage, secretProblems, type FacebookPage } from "./facebook";
import { setOutput } from "./kinds/breaking";
import { USER_AGENT } from "./source";
import { loadPostState, savePostState, warningPosts, WARNING_EVENTS, withinCap, type WarningPost } from "./warning-posts";

const env = process.env;
const dir = env.FB_STATE_DIR || "shorts/.state";

const NO_TOKEN = "Set the FB_PAGE_TOKEN secret (shorts/README.md, Facebook).";

/** The token's Page, with a warning when FB_PAGE_ID names something else. */
async function thePage(): Promise<FacebookPage> {
  const given = pageFromEnv(env);
  if (!given) throw new Error(NO_TOKEN);
  const { page, name, link, mismatch } = await resolvePage(given);
  console.log(`The token is the Page "${name}"'s${link ? ` (${link})` : ""}.`);
  if (mismatch) console.log("::warning::FB_PAGE_ID isn't this Page's id (it may be the App ID); posting to the token's Page. You can delete FB_PAGE_ID.");
  return page;
}

async function check() {
  for (const p of secretProblems(env.FB_PAGE_ID, env.FB_PAGE_TOKEN)) console.log(`::warning::${p}`);
  const page = await thePage();
  // A hidden post, deleted at once: proves the token can post without anyone seeing it.
  const id = await postToPage(page, "Storm Central test post (hidden, deleted right away).", { published: false });
  console.log("Made a hidden test post; deleting it.");
  await deletePost(page, id);
  console.log("Posting works.");
}

/** The warnings out now, and which of them are due (within the hourly cap) or skipped. */
async function findDue() {
  const url = `https://api.weather.gov/alerts/active?status=actual&event=${encodeURIComponent(WARNING_EVENTS.join(","))}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`NWS alerts: ${res.status}`);
  const features = ((await res.json()) as { features?: RawAlertFeature[] }).features ?? [];
  const state = loadPostState(dir);
  const now = Date.now();
  const posts = warningPosts(features, state.levels, { severe: env.FB_SEVERE === "all" ? "all" : "destructive", now });
  const perHour = Math.max(1, Number(env.FB_POSTS_PER_HOUR) || 12);
  const { post: due, skip } = withinCap(posts, state, perHour, now);
  console.log(`${features.length} warnings out; ${posts.length} new to post${skip.length ? `, ${skip.length} over the ${perHour}-an-hour cap (skipped)` : ""}.`);
  return { state, now, due, skip };
}

async function plan() {
  const { due: d } = await findDue();
  setOutput(env, "due", String(d.length));
}

/** The post's picture, or null (it then goes up as text and a link): a warning is never held back by its picture. */
async function picture(p: WarningPost): Promise<Buffer | null> {
  if (env.FB_CARDS === "false") return null;
  try {
    const { renderCard } = await import("./warning-card");
    return await renderCard(p.card);
  } catch (err) {
    console.log(`::warning::No picture for ${p.base}, posting text only: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function post() {
  const dry = env.FB_DRY_RUN === "1";
  if (!dry && !pageFromEnv(env)) throw new Error(NO_TOKEN);
  const { state, now, due, skip } = await findDue();
  // Facebook is asked which Page the token is only when there's something to post (runs come every few minutes).
  const page = !dry && due.length ? await thePage() : null;
  let failed: unknown = null;
  for (const p of due) {
    const image = await picture(p);
    if (dry) {
      console.log(`\n── ${p.base} ──\n${p.message}`);
      if (image) {
        const out = env.FB_OUT_DIR || "shorts/out";
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, `${p.base}.jpg`), image);
        console.log(`(picture: ${join(out, `${p.base}.jpg`)})`);
      }
    } else {
      try {
        const id = image ? await postPhoto(page!, image, p.message) : await postToPage(page!, p.message, { link: "https://app.stormcentralwx.com" });
        console.log(`Posted ${p.title} (${p.base})${image ? " with its picture" : ""} → ${id}`);
      } catch (err) {
        // One failed post doesn't stop the others; it's tried again next run.
        console.error(`Posting ${p.base} failed: ${err instanceof Error ? err.message : err}`);
        failed = err;
        continue;
      }
    }
    state.levels[p.base] = p.level;
    state.at[p.base] = now;
  }
  for (const p of skip) {
    state.levels[p.base] = p.level;
    state.at[p.base] = now - 3_600_000; // handled, but not counted against the next hour
  }
  if (!dry) savePostState(dir, state, now);
  if (failed) throw failed;
}

({ check, plan }[process.argv[2] ?? ""] ?? post)().catch((err: unknown) => {
  console.error(`::error::${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
