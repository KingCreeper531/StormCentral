/**
 * Storm Central's X bot: one run posts the morning severe weather outlook
 * once SPC issues it (bot/outlook.ts), fetches the active NWS warnings and
 * watches, posts the ones worth posting (bot/select.ts) and remembers them in
 * a small state file so nothing is posted twice. It runs every few minutes,
 * either in GitHub Actions with the X API (.github/workflows/x-bot.yml) or on
 * your PC through twikit (bot/local/); see bot/README.md.
 *
 * Environment:
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET  X API credentials (missing → dry run)
 *   BOT_POSTER=twikit      post through twikit with browser cookies instead (bot/local/README.md):
 *     BOT_PYTHON, BOT_TWIKIT_SCRIPT, BOT_TWIKIT_COOKIES  Python, the script and the cookies file
 *     BOT_X_ACCOUNT        the only account it may post as (default Storm__Central)
 *   BOT_DRY_RUN=1          print the posts instead of posting, and keep the state unchanged
 *   BOT_STATE              state file path (default bot/.state/state.json)
 *   BOT_DAILY_LIMIT        posts per UTC day, emergencies excepted (default 16 with the API, 30 with twikit)
 *   BOT_MAX_PER_RUN        posts per run (default 4 with the API, 3 with twikit)
 *   BOT_MIN_GAP_S          seconds between posts (default 0 with the API, 60 with twikit)
 *   BOT_LINKS=false        leave out the Storm Central links (X charges more for posts with links)
 *   BOT_OUTLOOK=false      don't post the morning outlook
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { composeOutlookPost, outlookImageUrl, parseOutlook } from "./outlook";
import { composePost, selectCandidates, type BotFeature, type Level } from "./select";
import { posterFromEnv, type Poster } from "./poster";
import { XError } from "./x-client";

const EVENTS = ["Tornado Warning", "Extreme Wind Warning", "Severe Thunderstorm Warning", "Flash Flood Warning", "Tornado Watch", "Severe Thunderstorm Watch"];
const API = "https://api.weather.gov";
const NWS = `${API}/alerts/active?status=actual&message_type=alert,update&event=${EVENTS.map(encodeURIComponent).join(",")}`;
const USER_AGENT = "StormCentralBot/1.0 (github.com/KingCreeper531/StormCentral)";
/** Older than this when first seen, a warning is old news; watches get longer. */
const FRESH_WARNING_MS = 20 * 60_000;
const FRESH_WATCH_MS = 60 * 60_000;
/** Posted keys are forgotten after this long. */
const KEEP_MS = 3 * 86_400_000;
/** The morning Day 1 outlook (13Z, out around 8 AM Eastern), posted up to 3 hours after it's issued. */
const MORNING_CYCLE = "1300";
const OUTLOOK_FRESH_MS = 3 * 3_600_000;
/** SPC's map lags the text by a few minutes; wait this long for it before posting without one. */
const MAP_WAIT_MS = 20 * 60_000;

interface State {
  version: 1;
  posted: Record<string, { level: Level; at: number }>;
  day: string;
  countToday: number;
}

const env = process.env;
const twikit = env.BOT_POSTER === "twikit";
const statePath = env.BOT_STATE ?? "bot/.state/state.json";
// twikit posts as the logged-in account, so it goes slower and posts less.
const dailyLimit = Math.max(1, Number(env.BOT_DAILY_LIMIT) || (twikit ? 30 : 16));
const maxPerRun = Math.max(1, Number(env.BOT_MAX_PER_RUN) || (twikit ? 3 : 4));
const minGapMs = Math.max(0, Number(env.BOT_MIN_GAP_S ?? (twikit ? 60 : 0)) || 0) * 1000;
/** The account needs you (logged out, locked, suspended, or flagged as automated): stop, and stop the loop. */
const EXIT_ACCOUNT = 3;
const isAccountProblem = (err: unknown): err is XError => err instanceof XError && err.status === 401;

let lastPostAt = 0;
/** Waits out BOT_MIN_GAP_S since the last post of this run. */
async function pace() {
  const wait = lastPostAt + minGapMs - Date.now();
  if (lastPostAt && wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastPostAt = Date.now();
}
const links = env.BOT_LINKS !== "false";
const outlookOn = env.BOT_OUTLOOK !== "false";

function loadState(): State | null {
  try {
    const s = JSON.parse(readFileSync(statePath, "utf8")) as State;
    return s.version === 1 ? s : null;
  } catch {
    return null;
  }
}

function saveState(s: State) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(s));
}

async function nws<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  return (await res.json()) as T;
}

const fetchAlerts = async () => (await nws<{ features?: BotFeature[] }>(NWS)).features ?? [];

/** The latest Day 1 outlook text (SWODY1) and when it was issued. */
async function latestOutlook(): Promise<{ text: string; issued: number } | null> {
  const list = await nws<{ "@graph"?: { id: string; issuanceTime: string }[] }>(`${API}/products/types/SWO/locations/DY1`);
  const latest = list["@graph"]?.[0];
  if (!latest) return null;
  const product = await nws<{ productText?: string; issuanceTime?: string }>(`${API}/products/${latest.id}`);
  return product.productText ? { text: product.productText, issued: Date.parse(product.issuanceTime ?? latest.issuanceTime) } : null;
}

/** SPC's outlook map, or "stale" while it still shows the previous day's. */
async function outlookMap(url: string, issued: number): Promise<{ bytes: Uint8Array; type: string } | "stale" | null> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const modified = Date.parse(res.headers.get("last-modified") ?? "");
  if (modified < issued - 30 * 60_000) return "stale";
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "image/png" };
}

/** Posts the morning outlook with SPC's map when it's out and not yet posted (a dry run always shows it). */
async function morningOutlook(state: State, now: number, poster: Poster | null, today: string) {
  const dry = !poster;
  if (!dry && state.posted[`outlook:${today}`]) return;
  const latest = await latestOutlook();
  const o = latest && parseOutlook(latest.text);
  if (!latest || !o) return console.log("Outlook: no Day 1 outlook found.");

  const key = `outlook:${new Date(latest.issued).toISOString().slice(0, 10)}`;
  const text = composeOutlookPost(o, { links });
  const notDue =
    o.cycle !== MORNING_CYCLE
      ? `the latest is the ${o.cycle}Z update; the morning post follows the ${MORNING_CYCLE}Z outlook`
      : now - latest.issued > OUTLOOK_FRESH_MS
        ? "issued over 3 hours ago"
        : state.posted[key]
          ? "already posted"
          : "";
  if (notDue) {
    if (dry) console.log(`\n--- outlook, not due (${notDue}); it reads ---\n${text}\n`);
    return;
  }

  const map = await outlookMap(outlookImageUrl(o.cycle), latest.issued).catch(() => null);
  if (map === "stale" && now - latest.issued < MAP_WAIT_MS) return console.log("Outlook: waiting for SPC's map to update.");
  const image = map && map !== "stale" ? map : null;
  if (dry) return console.log(`\n--- would post the outlook (${o.validFrom}, ${image ? `with the ${image.bytes.length >> 10} KB map` : "no map"}) ---\n${text}\n`);

  try {
    await pace();
    const id = await poster.post(text, image);
    console.log(`Posted the outlook → https://x.com/i/status/${id}`);
  } catch (err) {
    if (!(err instanceof XError && err.status === 403 && /duplicate/i.test(err.message))) throw err;
  }
  state.posted[key] = { level: "normal", at: now };
  state.countToday++;
}

async function main() {
  const now = Date.now();
  const poster = posterFromEnv();
  const dry = env.BOT_DRY_RUN === "1" || !poster;
  const today = new Date(now).toISOString().slice(0, 10);

  const saved = loadState();
  const state: State = saved ?? { version: 1, posted: {}, day: today, countToday: 0 };
  if (state.day !== today) Object.assign(state, { day: today, countToday: 0 });
  for (const [k, v] of Object.entries(state.posted)) if (now - v.at > KEEP_MS) delete state.posted[k];

  // The outlook first (it's once a day and outside the daily limit); its failure mustn't stop the warnings.
  if (outlookOn) {
    try {
      await morningOutlook(state, now, dry ? null : poster, today);
    } catch (err) {
      if (isAccountProblem(err)) {
        saveState(state);
        throw err;
      }
      console.warn(`Outlook: ${err instanceof Error ? err.message : err}`);
    }
  }

  const features = await fetchAlerts();
  const levels = Object.fromEntries(Object.entries(state.posted).map(([k, v]) => [k, v.level]));
  const candidates = selectCandidates(features, levels, now);
  console.log(`${features.length} active alerts, ${candidates.length} worth posting${dry ? " (dry run)" : ""}`);

  // First run: remember what's already going on instead of posting a backlog.
  if (!saved && !dry) {
    for (const c of candidates) state.posted[c.eventKey] = { level: c.level, at: now };
    saveState(state);
    console.log(`First run: noted ${candidates.length} alerts already in effect; posting starts with the next new one.`);
    return;
  }

  let posted = 0;
  for (const c of candidates) {
    const age = now - Date.parse(c.alert.sent);
    const fresh = age <= (c.vtec?.significance === "A" ? FRESH_WATCH_MS : FRESH_WARNING_MS);
    if (!fresh) {
      // Old news: never post it, but remember it so an upgrade can still be posted.
      if (!dry) state.posted[c.eventKey] = { level: c.level, at: now };
      continue;
    }
    if (posted >= maxPerRun) break;
    if (c.priority > 1 && state.countToday >= dailyLimit) {
      console.log(`Daily limit (${dailyLimit}) reached; skipping ${c.key}`);
      continue;
    }

    const text = composePost(c, { links });
    if (dry) {
      console.log(`\n--- would post (${c.key}) ---\n${text}\n`);
      posted++;
      continue;
    }
    try {
      await pace();
      const id = await poster!.post(text);
      console.log(`Posted ${c.key} → https://x.com/i/status/${id}`);
      state.posted[c.eventKey] = { level: c.level, at: now };
      state.countToday++;
      posted++;
    } catch (err) {
      if (err instanceof XError && err.status === 403 && /duplicate/i.test(err.message)) {
        state.posted[c.eventKey] = { level: c.level, at: now };
        continue;
      }
      if (err instanceof XError && err.status === 429) {
        console.warn("X rate limit reached; trying again next run.");
        break;
      }
      saveState(state);
      throw err;
    }
  }
  if (!dry) saveState(state);
  console.log(`Done: ${posted} ${dry ? "would be posted" : "posted"}, ${state.countToday}/${dailyLimit} today.`);
}

main().catch((err) => {
  if (isAccountProblem(err)) {
    console.error(`${err.message}\nThe X account needs attention: log in on x.com, deal with any prompt there, then refresh the cookies file before starting the bot again.`);
    process.exit(EXIT_ACCOUNT);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
