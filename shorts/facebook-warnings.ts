/**
 * Posts new warnings to the Storm Central Facebook Page (warning-posts.ts
 * says which and what), run every few minutes by
 * .github/workflows/facebook-warnings.yml with the posted ones kept in the
 * Actions cache.
 *
 *   node facebook-warnings.mjs          post what's new (FB_PAGE_ID, FB_PAGE_TOKEN, FB_POSTS_PER_HOUR, FB_SEVERE)
 *   node facebook-warnings.mjs check    test the token: read the Page's name, make a hidden post and delete it
 *   FB_DRY_RUN=1                        print the posts instead of posting them
 *
 * FB_STATE_DIR is where the posted warnings are kept (default shorts/.state).
 */
import type { RawAlertFeature } from "../src/lib/alerts";
import { deletePost, pageFromEnv, pageInfo, postToPage } from "./facebook";
import { USER_AGENT } from "./source";
import { loadPostState, savePostState, warningPosts, WARNING_EVENTS, withinCap } from "./warning-posts";

const env = process.env;
const dir = env.FB_STATE_DIR || "shorts/.state";

async function check() {
  const page = pageFromEnv(env);
  if (!page) throw new Error("Set the FB_PAGE_ID and FB_PAGE_TOKEN secrets (shorts/README.md, Facebook).");
  const info = await pageInfo(page);
  console.log(`The token works for the Page "${info.name}"${info.link ? ` (${info.link})` : ""}.`);
  // A hidden post, deleted at once: proves the token can post without anyone seeing it.
  const id = await postToPage(page, "Storm Central test post (hidden, deleted right away).", { published: false });
  console.log("Made a hidden test post; deleting it.");
  await deletePost(page, id);
  console.log("Posting works.");
}

async function post() {
  const dry = env.FB_DRY_RUN === "1";
  const page = pageFromEnv(env);
  if (!page && !dry) throw new Error("Set the FB_PAGE_ID and FB_PAGE_TOKEN secrets (shorts/README.md, Facebook).");
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
  let failed: unknown = null;
  for (const p of due) {
    if (dry) {
      console.log(`\n── ${p.base} ──\n${p.message}`);
    } else {
      try {
        const id = await postToPage(page!, p.message, { link: "https://app.stormcentralwx.com" });
        console.log(`Posted ${p.title} (${p.base}) → ${id}`);
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

(process.argv[2] === "check" ? check() : post()).catch((err) => {
  console.error(`::error::${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
