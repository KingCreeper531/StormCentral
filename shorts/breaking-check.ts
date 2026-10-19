/**
 * The breaking-news workflow's quick look (no browser, a few seconds): is
 * there a new event to post? Sets the step output `event` to its key (empty
 * when there's none, it was posted already, or today's cap is reached), and
 * `any` to "true" when anything qualifies at all (for manual runs).
 *
 *   node breaking-check.mjs              look (SHORTS_STATE_DIR, SHORTS_BREAKING_DAILY_MAX, SHORTS_FIXTURES)
 *   node breaking-check.mjs mark k1,k2   record those events as posted
 */
import { clockOf, findEvents, limits, loadState, markPosted, postedToday, setOutput, toPost } from "./kinds/breaking";

const env = process.env;
const dir = env.SHORTS_STATE_DIR || "shorts/.state";

async function main() {
  if (process.argv[2] === "mark") {
    const keys = (process.argv[3] ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    markPosted(dir, keys);
    return console.log(`Marked as posted: ${keys.join(", ") || "nothing"}.`);
  }
  const now = clockOf(env);
  const events = await findEvents({ env, fixtures: env.SHORTS_FIXTURES || undefined }, now);
  const state = loadState(dir);
  const { dailyMax } = limits(env);
  const next = toPost(events, state, { dailyMax, perRun: 1, now })[0];
  console.log(`Qualifying now: ${events.map((e) => e.key).join(", ") || "none"}. Posted today: ${postedToday(state, now)} of ${dailyMax}.`);
  console.log(next ? `New: ${next.key}` : "Nothing new to post.");
  setOutput(env, "event", next?.key ?? "");
  setOutput(env, "any", events.length ? "true" : "");
}

main().catch((err) => {
  // A failed look is a skipped run, not a failed one: the next run in 10 minutes tries again.
  console.warn(`::warning::Breaking check failed: ${err instanceof Error ? err.message : err}`);
  setOutput(env, "event", "");
});
