/**
 * The daily health check (.github/workflows/health.yml): one run, one email
 * when something needs you, instead of a stream of "run failed" emails or a
 * silent outage. It checks the things that have broken before:
 *
 *   - the Facebook Page token (valid, and not expiring within EXPIRY_DAYS;
 *     a 1-hour token once took the warning posts down)
 *   - the YouTube refresh token, and that a Short went up in the last day
 *   - the Anthropic API key the Shorts' narration uses
 *   - the website and the app answering
 *   - failed runs of the posting workflows in the last day
 *
 * Problems fail the run (GitHub emails the failure); warnings only show in
 * the run's summary. Every check is skipped, not failed, when its secret
 * isn't set.
 */
import { appendFileSync } from "node:fs";
import { ANTHROPIC_API, ANTHROPIC_VERSION } from "./anthropic";
import { pageFromEnv } from "./facebook";
import { accessToken, credentialsFromEnv } from "./youtube";

export type Level = "ok" | "warn" | "problem" | "skip";
export interface Check {
  name: string;
  level: Level;
  detail: string;
}

const GRAPH = "https://graph.facebook.com/v25.0";
const DAY = 86_400_000;
/** A token expiring within this many days is a problem, so there's time to replace it. */
export const EXPIRY_DAYS = 10;
/** A Short goes up every morning; longer than this without one is a problem. */
export const UPLOAD_HOURS = 30;
/** The workflows whose failures mean something didn't post. */
export const WATCHED = ["youtube-shorts.yml", "youtube-breaking.yml", "facebook-warnings.yml"];

type Fetch = typeof fetch;

/** The permissions the warning posts need. */
export const FB_SCOPES = ["pages_manage_posts", "pages_read_engagement"];

/** What Meta's token debugger says, as a check: invalid, expiring soon, or fine (expires_at 0 = never). */
export function tokenCheck(data: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; error?: { message?: string } } | undefined, now = Date.now()): Check {
  const name = "Facebook Page token";
  if (!data?.is_valid) return { name, level: "problem", detail: `Not valid${data?.error?.message ? `: ${data.error.message}` : ""}. Make a new one (shorts/README.md, Facebook).` };
  // Valid but unable to post: a permission was taken away (Facebook then refuses every warning post).
  const missing = data.scopes ? FB_SCOPES.filter((s) => !data.scopes!.includes(s)) : [];
  if (missing.length) return { name, level: "problem", detail: `Missing the ${missing.join(" and ")} permission${missing.length > 1 ? "s" : ""}, so it can't post. Make a new one (shorts/README.md, Facebook).` };
  const ends = [data.expires_at, data.data_access_expires_at].filter((t): t is number => !!t && t > 0).map((t) => t * 1000);
  const soonest = ends.length ? Math.min(...ends) : null;
  if (soonest == null) return { name, level: "ok", detail: "Valid, never expires." };
  const days = Math.floor((soonest - now) / DAY);
  const when = new Date(soonest).toISOString().slice(0, 10);
  if (days < EXPIRY_DAYS) return { name, level: "problem", detail: `Expires in ${Math.max(0, days)} days (${when}). Make a new one now (shorts/README.md, Facebook).` };
  return { name, level: "ok", detail: `Valid until ${when}.` };
}

/** The newest upload's age as a check. */
export function uploadCheck(publishedAt: string | null, now = Date.now()): Check {
  const name = "Latest YouTube upload";
  if (!publishedAt) return { name, level: "problem", detail: "No uploads found on the channel." };
  const hours = Math.round((now - Date.parse(publishedAt)) / 3_600_000);
  return hours > UPLOAD_HOURS
    ? { name, level: "problem", detail: `${hours} hours ago (${publishedAt}): the daily Shorts aren't going up.` }
    : { name, level: "ok", detail: `${hours} hours ago.` };
}

/** Failed runs of the watched workflows as a check (a few are warnings; a run of them is a problem). */
export function failuresCheck(failed: Record<string, number>): Check {
  const name = "Posting workflows (last 24 h)";
  const bad = Object.entries(failed).filter(([, n]) => n > 0);
  if (!bad.length) return { name, level: "ok", detail: "No failed runs." };
  const total = bad.reduce((s, [, n]) => s + n, 0);
  return { name, level: total >= 3 ? "problem" : "warn", detail: bad.map(([w, n]) => `${w}: ${n} failed`).join(", ") };
}

async function facebook(env: Record<string, string | undefined>, f: Fetch): Promise<Check> {
  const page = pageFromEnv(env);
  if (!page) return { name: "Facebook Page token", level: "skip", detail: "FB_PAGE_TOKEN isn't set." };
  const q = new URLSearchParams({ input_token: page.token, access_token: page.token });
  const res = await f(`${GRAPH}/debug_token?${q}`, { signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as { data?: Parameters<typeof tokenCheck>[0]; error?: { message?: string } };
  return tokenCheck(json.data ?? { is_valid: false, error: json.error });
}

async function youtube(env: Record<string, string | undefined>, f: Fetch): Promise<Check[]> {
  const creds = credentialsFromEnv(env);
  if (!creds) return [{ name: "YouTube", level: "skip", detail: "The YouTube secrets aren't set." }];
  let token: string;
  try {
    token = await accessToken(creds);
  } catch (err) {
    return [{ name: "YouTube refresh token", level: "problem", detail: `Rejected: ${err instanceof Error ? err.message : err}. Make a new refresh token (shorts/README.md).` }];
  }
  const out: Check[] = [{ name: "YouTube refresh token", level: "ok", detail: "Works." }];
  const api = "https://www.googleapis.com/youtube/v3";
  const auth = { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) };
  // 2 quota units: the channel's uploads playlist, then its newest item.
  const ch = (await (await f(`${api}/channels?part=contentDetails&mine=true`, auth)).json()) as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] };
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [...out, { name: "Latest YouTube upload", level: "warn", detail: "Couldn't find the channel's uploads." }];
  const items = (await (await f(`${api}/playlistItems?part=contentDetails&maxResults=1&playlistId=${uploads}`, auth)).json()) as { items?: { contentDetails?: { videoPublishedAt?: string } }[] };
  return [...out, uploadCheck(items.items?.[0]?.contentDetails?.videoPublishedAt ?? null)];
}

async function anthropicKey(env: Record<string, string | undefined>, f: Fetch): Promise<Check> {
  const name = "Anthropic API key (Shorts narration)";
  if (!env.ANTHROPIC_API_KEY) return { name, level: "skip", detail: "ANTHROPIC_API_KEY isn't set (the Shorts use the plain script)." };
  // Listing models costs nothing and proves the key works.
  const res = await f(`${ANTHROPIC_API}/models?limit=1`, { headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": ANTHROPIC_VERSION }, signal: AbortSignal.timeout(20_000) });
  return res.ok ? { name, level: "ok", detail: "Works." } : { name, level: "warn", detail: `Rejected (${res.status}); the Shorts fall back to the plain script.` };
}

async function sites(f: Fetch): Promise<Check[]> {
  return Promise.all(
    ["https://www.stormcentralwx.com", "https://app.stormcentralwx.com"].map(async (url) => {
      const name = url.replace("https://", "");
      try {
        const t0 = Date.now();
        const res = await f(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
        return res.ok ? { name, level: "ok" as const, detail: `Up (${Date.now() - t0} ms).` } : { name, level: "problem" as const, detail: `Answered ${res.status}.` };
      } catch (err) {
        return { name, level: "problem" as const, detail: `Down: ${err instanceof Error ? err.message : err}` };
      }
    }),
  );
}

async function workflows(env: Record<string, string | undefined>, f: Fetch, now: number): Promise<Check> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) return { name: "Posting workflows (last 24 h)", level: "skip", detail: "Not running in GitHub Actions." };
  const since = new Date(now - DAY).toISOString();
  const failed: Record<string, number> = {};
  for (const w of WATCHED) {
    const res = await f(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${w}/runs?status=failure&per_page=100&created=>${since}`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    });
    failed[w] = res.ok ? (((await res.json()) as { total_count?: number }).total_count ?? 0) : 0;
  }
  return failuresCheck(failed);
}

const ICON: Record<Level, string> = { ok: "✅", warn: "⚠️", problem: "❌", skip: "➖" };

export function report(checks: Check[]): string {
  const problems = checks.filter((c) => c.level === "problem").length;
  return [
    problems ? `## ${problems} problem${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention` : "## All good",
    "",
    "| | Check | Detail |",
    "|---|---|---|",
    ...checks.map((c) => `| ${ICON[c.level]} | ${c.name} | ${c.detail.replace(/\|/g, "/")} |`),
  ].join("\n");
}

export async function runChecks(env: Record<string, string | undefined> = process.env, f: Fetch = fetch, now = Date.now()): Promise<Check[]> {
  // One check failing to run is reported, not fatal to the rest.
  const safe = async (name: string, p: Promise<Check | Check[]>): Promise<Check[]> => {
    try {
      const r = await p;
      return Array.isArray(r) ? r : [r];
    } catch (err) {
      return [{ name, level: "warn", detail: `Couldn't check: ${err instanceof Error ? err.message : err}` }];
    }
  };
  return (
    await Promise.all([
      safe("Facebook Page token", facebook(env, f)),
      safe("YouTube", youtube(env, f)),
      safe("Anthropic API key", anthropicKey(env, f)),
      safe("Sites", sites(f)),
      safe("Posting workflows", workflows(env, f, now)),
    ])
  ).flat();
}

async function main() {
  const checks = await runChecks();
  const md = report(checks);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  for (const c of checks.filter((x) => x.level === "problem")) console.log(`::error title=${c.name}::${c.detail}`);
  if (checks.some((c) => c.level === "problem")) process.exit(1);
}

if (process.argv[1]?.endsWith("health.mjs")) main();
