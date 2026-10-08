import { GITHUB_REPO } from "../platform";

/**
 * Update check for the Android app: compares the installed version with the
 * latest GitHub release and offers its APK. (The Windows app updates itself
 * through electron-updater instead.) Checks at most every 6 hours, because
 * unauthenticated GitHub API calls are limited to 60 per hour per IP.
 */
export interface AvailableUpdate {
  version: string;
  apkUrl: string;
  releaseUrl: string;
}

interface CheckState {
  checkedAt: number;
  latest: AvailableUpdate | null;
  dismissed?: string;
}

const KEY = "stormcentral:app-update";
const CHECK_EVERY_MS = 6 * 3_600_000;

function readState(): CheckState | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as CheckState | null;
  } catch {
    return null;
  }
}

function writeState(state: CheckState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: we'll just check again next launch */
  }
}

/** Numeric dotted-version comparison; a prerelease suffix ("-beta.1") is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split("-")[0]!.split(".").map(Number);
  const pb = b.replace(/^v/, "").split("-")[0]!.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

async function fetchLatest(): Promise<AvailableUpdate | null> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const rel = (await res.json()) as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] };
  const apk = rel.assets?.find((a) => a.name.toLowerCase().endsWith(".apk"));
  if (!rel.tag_name || !apk) return null;
  return { version: rel.tag_name.replace(/^v/, ""), apkUrl: apk.browser_download_url, releaseUrl: rel.html_url ?? apk.browser_download_url };
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const { App } = await import("@capacitor/app");
  const installed = (await App.getInfo()).version;

  let state = readState();
  if (!state || Date.now() - state.checkedAt > CHECK_EVERY_MS) {
    const latest = await fetchLatest().catch(() => state?.latest ?? null);
    state = { checkedAt: Date.now(), latest, dismissed: state?.dismissed };
    writeState(state);
  }
  const latest = state.latest;
  if (!latest || compareVersions(latest.version, installed) <= 0 || state.dismissed === latest.version) return null;
  return latest;
}

/** Hide the notice until a newer release than `version` appears. */
export function dismissUpdate(version: string) {
  const state = readState();
  if (state) writeState({ ...state, dismissed: version });
}
