// @ts-check
import { app, BrowserWindow, dialog, net, shell } from "electron";
import { compareVersions, httpsUrl, parseRelease } from "./release-info.mjs";

/**
 * Update notices for the Mac app, which can't update itself: it's ad-hoc
 * signed (no Apple Developer ID), and Squirrel.Mac, which electron-updater
 * installs through on macOS, only accepts updates signed with one. Instead
 * this checks the latest GitHub release on launch and every 4 hours and, when
 * it's newer, says so with a Download button that opens the .dmg in the
 * browser, like the Android app's notice. updater.mjs routes here on macOS.
 */
const CHECK_EVERY_MS = 4 * 3_600_000;
/** Settings checks when it opens and again from its button; one GitHub call answers both. */
const FRESH_MS = 60_000;

/** @typedef {import("./release-info.mjs").ReleaseInfo} ReleaseInfo */

/** @type {(m: string) => void} */
let log = () => {};
let repo = "";
/** @type {ReleaseInfo | null} The latest release seen. */
let latest = null;
let checkedAt = 0;
/** @type {Promise<ReleaseInfo> | null} */
let inFlight = null;
/** A version announced by the automatic check isn't announced again until the app restarts. */
let announced = "";

const current = () => app.getVersion();
const newer = () => (latest && compareVersions(latest.version, current()) > 0 ? latest : null);
/** @param {unknown} err */
const reason = (err) => (err instanceof Error ? err.message : String(err));

/**
 * A dialog on a visible window, or on its own: a sheet on a window hidden by
 * closing it would never be seen.
 * @param {import("electron").MessageBoxOptions} opts
 */
function show(opts) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => w.isVisible());
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

/** @param {string} url */
function openInBrowser(url) {
  const href = httpsUrl(url);
  if (href) void shell.openExternal(href);
}

async function fetchLatest() {
  const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `StormCentral/${current()}` },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const info = parseRelease(await res.json());
  if (!info) throw new Error("the latest release has no version or download");
  return info;
}

/** The latest release, from GitHub or from a check in the last minute. Throws when GitHub can't be reached. */
function refresh() {
  if (latest && Date.now() - checkedAt < FRESH_MS) return Promise.resolve(latest);
  inFlight ??= fetchLatest()
    .then((info) => {
      latest = info;
      checkedAt = Date.now();
      return info;
    })
    .finally(() => (inFlight = null));
  return inFlight;
}

/** @param {ReleaseInfo} release */
async function announce(release) {
  announced = release.version;
  const { response } = await show({
    type: "info",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
    message: `Storm Central ${release.version} is available`,
    detail: `You have version ${current()}. Download the new one, open it and drag Storm Central to Applications to replace this copy. Your settings stay.`,
  });
  if (response === 0) openInBrowser(release.downloadUrl);
}

async function autoCheck() {
  try {
    await refresh();
  } catch (err) {
    log(`updates: check failed: ${reason(err)}`);
    return;
  }
  const release = newer();
  if (!release || announced === release.version) return;
  log(`updates: ${release.version} is available`);
  await announce(release);
}

/** @param {{ log: (m: string) => void, repo: string }} opts */
export function initReleaseChecks(opts) {
  log = opts.log;
  repo = /^[\w.-]+\/[\w.-]+$/.test(opts.repo) ? opts.repo : "";
  if (!repo) {
    log("updates: no repository to check");
    return;
  }
  log(`updates: checking ${repo} releases (this build can't install updates itself)`);
  void autoCheck();
  setInterval(() => void autoCheck(), CHECK_EVERY_MS);
}

/** App menu or menu bar icon → Check for updates… */
export async function checkReleasesFromMenu() {
  // Picked from the menu bar icon, the app may be behind other windows; bring it forward for the answer.
  app.focus({ steal: true });
  try {
    if (!repo) throw new Error("no repository to check");
    await refresh();
  } catch (err) {
    log(`updates: check failed: ${reason(err)}`);
    void show({ type: "warning", message: "Couldn't check for updates", detail: "Check your internet connection and try again." });
    return;
  }
  const release = newer();
  if (release) await announce(release);
  else void show({ type: "info", message: "Storm Central is up to date", detail: `Version ${current()} is the latest release.` });
}

/**
 * Settings → Check for updates: the result for the page, which shows a
 * Download link when a newer version is out (no dialog).
 * @returns {Promise<{ state: "available" | "current" | "error", current: string, latest: string | null, downloadUrl?: string }>}
 */
export async function checkReleasesFromPage() {
  try {
    if (!repo) throw new Error("no repository to check");
    await refresh();
  } catch (err) {
    log(`updates: check failed: ${reason(err)}`);
    return { state: "error", current: current(), latest: latest?.version ?? null };
  }
  const release = newer();
  if (release) return { state: "available", current: current(), latest: release.version, downloadUrl: release.downloadUrl };
  return { state: "current", current: current(), latest: latest?.version ?? current() };
}

/** Opens the newer version's download in the browser. Returns false when there's none. */
export function openReleaseDownload() {
  const release = newer();
  if (!release) return false;
  openInBrowser(release.downloadUrl);
  return true;
}
