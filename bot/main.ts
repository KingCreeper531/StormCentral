/**
 * Storm Central's X bot: one run posts the morning severe weather outlook
 * once SPC issues it (bot/outlook.ts), fetches the active NWS warnings and
 * watches, posts the ones worth posting (bot/select.ts) and remembers them in
 * a small state file so nothing is posted twice. GitHub Actions runs it every few
 * minutes (.github/workflows/x-bot.yml); see bot/README.md.
 *
 * Environment:
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET  posting credentials (missing → dry run)
 *   BOT_DRY_RUN=1          print the posts instead of posting, and keep the state unchanged
 *   BOT_STATE              state file path (default bot/.state/state.json)
 *   BOT_DAILY_LIMIT        posts per UTC day, emergencies excepted (default 16, about 500 a month)
 *   BOT_MAX_PER_RUN        posts per run (default 4)
 *   BOT_LINKS=false        leave out the Storm Central links (X charges more for posts with links)
 *   BOT_OUTLOOK=false      don't post the morning outlook
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { composeOutlookPost, outlookImageUrl, parseOutlook } from "./outlook";
import { composePost, selectCandidates, type BotFeature, type Level } from "./select";
import { credentialsFromEnv, postToX, uploadImage, XError, type XCredentials } from "./x-client";

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
const statePath = env.BOT_STATE ?? "bot/.state/state.json";
const dailyLimit = Math.max(1, Number(env.BOT_DAILY_LIMIT) || 16);
const maxPerRun = Math.max(1, Number(env.BOT_MAX_PER_RUN) || 4);
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
async function morningOutlook(state: State, now: number, creds: XCredentials | null, today: string) {
  const dry = !creds;
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

  let media: string[] = [];
  if (image) {
    try {
      media = [await uploadImage(image.bytes, image.type, creds)];
    } catch (err) {
      console.warn(`Outlook map upload failed (${err instanceof Error ? err.message : err}); posting without it.`);
    }
  }
  try {
    const id = await postToX(text, creds, media);
    console.log(`Posted the outlook → https://x.com/i/status/${id}`);
  } catch (err) {
    if (!(err instanceof XError && err.status === 403 && /duplicate/i.test(err.message))) throw err;
  }
  state.posted[key] = { level: "normal", at: now };
  state.countToday++;
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

  // The outlook first (it's once a day and outside the daily limit); its failure mustn't stop the warnings.
  if (outlookOn) {
    try {
      await morningOutlook(state, now, dry ? null : creds, today);
    } catch (err) {
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
