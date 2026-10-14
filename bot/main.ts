/**
 * Storm Central's X bot: one run fetches the active NWS warnings and watches,
 * posts the ones worth posting (bot/select.ts) and remembers them in a small
 * state file so nothing is posted twice. GitHub Actions runs it every few
 * minutes (.github/workflows/x-bot.yml); see bot/README.md.
 *
 * Environment:
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET  posting credentials (missing → dry run)
 *   BOT_DRY_RUN=1          print the posts instead of posting, and keep the state unchanged
 *   BOT_STATE              state file path (default bot/.state/state.json)
 *   BOT_DAILY_LIMIT        posts per UTC day, emergencies excepted (default 16, about 500 a month)
 *   BOT_MAX_PER_RUN        posts per run (default 4)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { composePost, selectCandidates, type BotFeature, type Level } from "./select";
import { credentialsFromEnv, postToX, XError } from "./x-client";

const EVENTS = ["Tornado Warning", "Extreme Wind Warning", "Severe Thunderstorm Warning", "Flash Flood Warning", "Tornado Watch", "Severe Thunderstorm Watch"];
const NWS = `https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&event=${EVENTS.map(encodeURIComponent).join(",")}`;
const USER_AGENT = "StormCentralBot/1.0 (github.com/KingCreeper531/StormCentral)";
/** Older than this when first seen, a warning is old news; watches get longer. */
const FRESH_WARNING_MS = 20 * 60_000;
const FRESH_WATCH_MS = 60 * 60_000;
/** Posted keys are forgotten after this long. */
const KEEP_MS = 3 * 86_400_000;

interface State {
  version: 1;
  posted: Record<string, { level: Level; at: number }>;
  day: string;
  countToday: number;
}

const env = process.env;
const statePath = env.BOT_STATE ?? "bot/.state/state.json";
const dailyLimit = Math.max(1, Number(env.BOT_DAILY_LIMIT) || 16);
const maxPerRun = Math.max(1, Number(env.BOT_MAX_PER_RUN) || 4);

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

async function fetchAlerts(): Promise<BotFeature[]> {
  const res = await fetch(NWS, { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  return ((await res.json()) as { features?: BotFeature[] }).features ?? [];
}

async function main() {
  const now = Date.now();
  const creds = credentialsFromEnv();
  const dry = env.BOT_DRY_RUN === "1" || !creds;
  const today = new Date(now).toISOString().slice(0, 10);

  const saved = loadState();
  const state: State = saved ?? { version: 1, posted: {}, day: today, countToday: 0 };
  if (state.day !== today) Object.assign(state, { day: today, countToday: 0 });
  for (const [k, v] of Object.entries(state.posted)) if (now - v.at > KEEP_MS) delete state.posted[k];

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

    const text = composePost(c);
    if (dry) {
      console.log(`\n--- would post (${c.key}) ---\n${text}\n`);
      posted++;
      continue;
    }
    try {
      const id = await postToX(text, creds!);
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
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
