// @ts-check
import { app, BrowserWindow, dialog } from "electron";
import updaterPkg from "electron-updater";
import { checkReleasesFromMenu, checkReleasesFromPage, initReleaseChecks, openReleaseDownload } from "./release-check.mjs";

/**
 * Updates from GitHub Releases. electron-builder writes the repository into
 * the packaged app (app-update.yml). We check on launch and every 4 hours,
 * download in the background, and ask before restarting. An update the user
 * defers installs when they next quit.
 *
 * The Mac app can't install updates (see release-check.mjs), so on macOS
 * every entry point here hands over to release-check.mjs, which tells the
 * user about a new version instead, and electron-updater is never started.
 */
const CHECK_EVERY_MS = 4 * 3_600_000;
/** The Microsoft Store version: the Store installs updates, so this updater stays off. */
export const storeBuild = !!process.windowsStore;
/** The Mac app: update notices only. */
const noticeOnly = process.platform === "darwin";

/** @type {(m: string) => void} */
let log = () => {};
/** Set while a check started from the menu is running, so its result is reported. */
let manualCheck = false;
let promptedFor = "";
/** Newest version seen, and whether it has finished downloading (for the Settings page). */
/** @type {{ latest: string | null, ready: boolean, downloading: boolean }} */
const state = { latest: null, ready: false, downloading: false };

const parent = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** @param {import("electron").MessageBoxOptions} opts */
function show(opts) {
  const win = parent();
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

async function check() {
  try {
    await updaterPkg.autoUpdater.checkForUpdates();
  } catch (err) {
    log(`updates: check failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** @param {{ log: (m: string) => void, repo: string }} opts */
export function initAutoUpdates(opts) {
  log = opts.log;
  if (!app.isPackaged) {
    log("updates: disabled in development builds");
    return;
  }
  if (storeBuild) {
    log("updates: handled by the Microsoft Store");
    return;
  }
  if (noticeOnly) {
    initReleaseChecks(opts);
    return;
  }
  // Created on first use, so the Mac app never sets up Squirrel.Mac.
  const { autoUpdater } = updaterPkg;
  autoUpdater.logger = { info: (m) => log(`updates: ${m}`), warn: (m) => log(`updates: ${m}`), error: (m) => log(`updates: ${m}`), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    state.latest = info.version;
    state.downloading = true;
    if (!manualCheck) return;
    manualCheck = false;
    void show({ type: "info", message: `Downloading Storm Central ${info.version}`, detail: "You'll be asked to restart when it's ready." });
  });
  autoUpdater.on("update-not-available", (info) => {
    state.latest = info?.version ?? app.getVersion();
    if (!manualCheck) return;
    manualCheck = false;
    void show({ type: "info", message: "Storm Central is up to date", detail: `Version ${app.getVersion()} is the latest release.` });
  });
  autoUpdater.on("error", (err) => {
    state.downloading = false;
    log(`updates: ${err.message}`);
    if (!manualCheck) return;
    manualCheck = false;
    void show({ type: "warning", message: "Couldn't check for updates", detail: "Check your internet connection and try again." });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    state.latest = info.version;
    state.ready = true;
    state.downloading = false;
    if (promptedFor === info.version) return;
    promptedFor = info.version;
    const { response } = await show({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `Storm Central ${info.version} is ready to install`,
      detail: "Restart to finish updating. If you choose Later, the update installs the next time you quit.",
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  void check();
  setInterval(() => void check(), CHECK_EVERY_MS);
}

/** Help → Check for updates… */
export function checkForUpdatesFromMenu() {
  if (!app.isPackaged) {
    void show({ type: "info", message: "Updates are disabled in development builds" });
    return;
  }
  if (storeBuild) {
    void show({ type: "info", message: "Storm Central updates through the Microsoft Store", detail: "New versions install automatically. To check now, open the Store's Library." });
    return;
  }
  if (noticeOnly) {
    void checkReleasesFromMenu();
    return;
  }
  manualCheck = true;
  void check();
}

/**
 * "available" (macOS only): a newer version is out, and downloadUrl is its .dmg or release page.
 * @typedef {{ state: "current" | "downloading" | "ready" | "available" | "error" | "unsupported" | "store", current: string, latest: string | null, downloadUrl?: string }} UpdateStatus
 */

/** @returns {UpdateStatus} */
function status() {
  const current = app.getVersion();
  if (!app.isPackaged) return { state: "unsupported", current, latest: null };
  if (storeBuild) return { state: "store", current, latest: null };
  if (state.ready) return { state: "ready", current, latest: state.latest };
  if (state.downloading) return { state: "downloading", current, latest: state.latest };
  return { state: "current", current, latest: state.latest ?? current };
}

/**
 * Settings → Check for updates: checks now and reports the result to the page
 * (no dialog). A newer version starts downloading; "ready" means restart to
 * install. On macOS, "available" comes with a download link instead.
 * @returns {Promise<UpdateStatus>}
 */
export async function checkForUpdatesFromPage() {
  if (app.isPackaged && noticeOnly) return checkReleasesFromPage();
  if (!app.isPackaged || storeBuild || state.ready) return status();
  try {
    const result = await updaterPkg.autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version ?? null;
    if (latest) state.latest = latest;
  } catch (err) {
    log(`updates: check failed: ${err instanceof Error ? err.message : err}`);
    return { state: "error", current: app.getVersion(), latest: state.latest };
  }
  return status();
}

/** Restart into a downloaded update (on macOS: open the newer version's download). Returns false when there's none. */
export function installUpdateFromPage() {
  if (noticeOnly) return app.isPackaged && openReleaseDownload();
  if (!state.ready) return false;
  setImmediate(() => updaterPkg.autoUpdater.quitAndInstall());
  return true;
}
