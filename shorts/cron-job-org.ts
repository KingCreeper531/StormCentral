/**
 * Sets up cron-job.org to start the Shorts workflows on time (GitHub often
 * starts its own schedules late or drops them; those stay as a backup, and
 * each kind still posts once a day). Run by the "Set up cron-job.org"
 * workflow: creates one cron-job.org job per Short, or updates the ones it
 * made before (found by title), through cron-job.org's REST API.
 *
 * Environment (the workflow passes each secret under the names it might have been saved as):
 *   CRONJOB_API_KEY (or CRON_JOB_API_KEY, CRONJOB_ORG_API_KEY, CRON_JOB_ORG_API_KEY, CRONJOB_KEY, CRON_API_KEY)
 *                     cron-job.org → Settings → API (no IP restriction: GitHub's runners change address)
 *   SHORTS_DISPATCH_TOKEN (or DISPATCH_TOKEN, GH_PAT, PAT)
 *                     a fine-grained GitHub token for this repository with Actions: Read and write,
 *                     which cron-job.org sends to start the workflows
 *   REPO              owner/name (GITHUB_REPOSITORY)
 */

export const KEY_NAMES = ["CRONJOB_API_KEY", "CRON_JOB_API_KEY", "CRONJOB_ORG_API_KEY", "CRON_JOB_ORG_API_KEY", "CRONJOB_KEY", "CRON_API_KEY"];
export const TOKEN_NAMES = ["SHORTS_DISPATCH_TOKEN", "DISPATCH_TOKEN", "GH_PAT", "PAT"];

/** The first of `names` set in `env`, and which it was. */
export function firstSecret(env: Record<string, string | undefined>, names: string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

const API = "https://api.cron-job.org";
/** Every job this script owns starts with this, so it can find them again. */
const PREFIX = "Storm Central:";
const ZONE = "America/New_York";
const EVERY = [-1];

export interface CronJob {
  title: string;
  url: string;
  enabled: boolean;
  saveResponses: boolean;
  /** cron-job.org's request methods: 0 GET, 1 POST. */
  requestMethod: number;
  extendedData: { headers: Record<string, string>; body: string };
  schedule: { timezone: string; expiresAt: number; hours: number[]; mdays: number[]; minutes: number[]; months: number[]; wdays: number[] };
}

interface Plan {
  name: string;
  workflow: string;
  inputs: Record<string, string>;
  hours: number[];
  minutes: number[];
  wdays?: number[];
}

/** When each Short starts, Eastern time (shorts/README.md has the same table). */
const PLANS: Plan[] = [
  { name: "outlook", workflow: "youtube-shorts.yml", inputs: { kind: "outlook" }, hours: [9], minutes: [12] },
  { name: "tropical", workflow: "youtube-shorts.yml", inputs: { kind: "tropical" }, hours: [11], minutes: [40] },
  { name: "fire", workflow: "youtube-shorts.yml", inputs: { kind: "fire" }, hours: [16], minutes: [30] },
  { name: "weekly", workflow: "youtube-shorts.yml", inputs: { kind: "weekly" }, hours: [9], minutes: [40], wdays: [0] },
  { name: "recap", workflow: "youtube-shorts.yml", inputs: { kind: "recap" }, hours: [23], minutes: [15] },
  { name: "lesson", workflow: "youtube-shorts.yml", inputs: { kind: "lesson" }, hours: [13], minutes: [20], wdays: [3] },
  // Every Thursday; only the third Thursday's (CPC's monthly update at 8:30 AM) finds a new outlook to post.
  { name: "seasonal", workflow: "youtube-shorts.yml", inputs: { kind: "seasonal" }, hours: [10], minutes: [45], wdays: [4] },
  // Five minutes after GitHub's own every-10-minutes schedule, so together they look every 5.
  { name: "breaking", workflow: "youtube-breaking.yml", inputs: {}, hours: EVERY, minutes: [5, 15, 25, 35, 45, 55] },
  // Warnings on Facebook: every 3 minutes (GitHub's own every-5-minutes schedule is often late).
  { name: "facebook", workflow: "facebook-warnings.yml", inputs: {}, hours: EVERY, minutes: Array.from({ length: 20 }, (_, i) => i * 3) },
];

/** The cron-job.org jobs that start each Short through GitHub's workflow-dispatch API. */
export function desiredJobs(repo: string, token: string): CronJob[] {
  return PLANS.map((p) => ({
    title: `${PREFIX} ${p.name}`,
    url: `https://api.github.com/repos/${repo}/actions/workflows/${p.workflow}/dispatches`,
    enabled: true,
    saveResponses: true,
    requestMethod: 1,
    extendedData: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { ...p.inputs, scheduled: "true" } }),
    },
    schedule: { timezone: ZONE, expiresAt: 0, hours: p.hours, mdays: EVERY, minutes: p.minutes, months: EVERY, wdays: p.wdays ?? EVERY },
  }));
}

type Fetch = typeof fetch;

/** Creates the jobs that don't exist yet and updates the rest. cron-job.org allows about 1 write a second. */
export async function syncJobs(apiKey: string, jobs: CronJob[], { fetchImpl = fetch as Fetch, pauseMs = 1_200, log = console.log } = {}) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`cron-job.org ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return text ? (JSON.parse(text) as unknown) : null;
  };
  const list = (await call("GET", "/jobs")) as { jobs?: { jobId: number; title?: string }[] } | null;
  const existing = new Map((list?.jobs ?? []).filter((j) => j.title?.startsWith(PREFIX)).map((j) => [j.title!, j.jobId]));
  const result = { created: 0, updated: 0 };
  for (const job of jobs) {
    const id = existing.get(job.title);
    if (id != null) {
      await call("PATCH", `/jobs/${id}`, { job });
      result.updated++;
      log(`Updated "${job.title}" (job ${id}).`);
    } else {
      const made = (await call("PUT", "/jobs", { job })) as { jobId?: number } | null;
      result.created++;
      log(`Created "${job.title}" (job ${made?.jobId ?? "?"}).`);
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return result;
}

async function main() {
  const key = firstSecret(process.env, KEY_NAMES);
  const token = firstSecret(process.env, TOKEN_NAMES);
  const repo = process.env.REPO;
  if (key) console.log(`cron-job.org API key: the ${key.name} secret.`);
  if (token) console.log(`GitHub token for cron-job.org to send: the ${token.name} secret.`);
  const missing = [!key && "a cron-job.org API key secret (CRONJOB_API_KEY)", !token && "a GitHub token secret (SHORTS_DISPATCH_TOKEN)", !repo && "REPO"].filter(Boolean);
  if (missing.length) throw new Error(`Missing ${missing.join(" and ")}; see shorts/README.md, "A reliable schedule".`);
  const { created, updated } = await syncJobs(key!.value, desiredJobs(repo!, token!.value));
  console.log(`\nDone: ${created} created, ${updated} updated. They're listed at https://console.cron-job.org/jobs.`);
}

if (process.argv[1]?.endsWith("cron-job-org.mjs")) {
  main().catch((err) => {
    console.error(`::error::${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
