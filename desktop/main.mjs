// @ts-check
/**
 * StormCentral for Windows. An Electron window around the app's own Next.js
 * server, which runs locally (server.mjs), so every feature works with no
 * hosting: radar, all modes, and accounts and reports stored on this PC.
 *
 * A build can instead point at a hosted StormCentral (STORMCENTRAL_URL at
 * build time, baked into package.json by electron-builder.config.mjs), so all
 * users share one spotter network. Updates come from GitHub Releases.
 *
 * A tray icon shows the current temperature. Closing the window can hide it
 * to the tray instead of quitting, so the page keeps watching for warnings,
 * and the app can start hidden at sign-in (settings.mjs, tray.mjs).
 */
import { app, autoUpdater as nativeUpdater, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLog } from "./log.mjs";
import { startLocalServer } from "./server.mjs";
import { openSettings, parseSettingsPatch, publicSettings } from "./settings.mjs";
import { appIcon, createTray, parseTrayStatus } from "./tray.mjs";
import { checkForUpdatesFromMenu, checkForUpdatesFromPage, initAutoUpdates, installUpdateFromPage } from "./updater.mjs";
import { loadWindowState, trackWindowState } from "./window-state.mjs";

const require = createRequire(import.meta.url);
/** @type {{ stormcentral?: { remoteUrl?: string | null, repo?: string } }} */
const meta = require("./package.json");

const APP_ID = "io.github.kingcreeper531.stormcentral";
const REPO = meta.stormcentral?.repo || "KingCreeper531/StormCentral";
const REMOTE_URL = httpsUrl(meta.stormcentral?.remoteUrl);
/** Permissions the UI may use: "Use my location", copying share links, map fullscreen. */
const ALLOWED_PERMISSIONS = new Set(["geolocation", "clipboard-sanitized-write", "fullscreen"]);
const PRELOAD = fileURLToPath(new URL("./preload.cjs", import.meta.url));
/** Passed by the sign-in login item: start in the tray, without a window. */
const START_HIDDEN = process.argv.includes("--hidden");
/** Must match between set- and getLoginItemSettings for `openAtLogin` to read back correctly. */
const LOGIN_ITEM = { args: ["--hidden"] };
/** IPC channels, mirrored in preload.cjs. */
const IPC = {
  trayStatus: "stormcentral:tray-status",
  showWindow: "stormcentral:show-window",
  getSettings: "stormcentral:get-settings",
  setSettings: "stormcentral:set-settings",
  checkUpdates: "stormcentral:check-updates",
  installUpdate: "stormcentral:install-update",
};

const log = createLog(path.join(app.getPath("logs"), "main.log"));
const settings = openSettings(path.join(app.getPath("userData"), "settings.json"), { log });
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {ReturnType<typeof createTray> | null} */
let tray = null;
/** Set once a real quit starts (tray Quit, File → Quit, an update install, sign-out), so closing isn't turned into hiding. */
let isQuitting = false;
/** Origin the UI is served from; anything else opens in the default browser. */
let appOrigin = "";
/** The UI's URL, once the server is up. */
let appUrl = "";
/** The first window exists; later launches just show it. */
let started = false;

/** @param {unknown} value */
function httpsUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** @param {string} url */
function isAppUrl(url) {
  try {
    return appOrigin !== "" && new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/** @param {string} url */
function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") void shell.openExternal(u.href);
  } catch {
    /* not a URL */
  }
}

// ─── Static pages shown before the app loads ────────────────────────────────

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="56" height="56"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#0b1220"/></radialGradient></defs><rect width="64" height="64" rx="14" fill="#000"/><circle cx="32" cy="32" r="22" fill="url(#g)" opacity=".35"/><circle cx="32" cy="32" r="22" fill="none" stroke="#38bdf8" stroke-opacity=".5" stroke-width="1.5"/><circle cx="32" cy="32" r="14" fill="none" stroke="#38bdf8" stroke-opacity=".35" stroke-width="1.5"/><path d="M32 32 L49 18 A22 22 0 0 1 54 32 Z" fill="#38bdf8" opacity=".55"/><path d="M35 14 L26 34 h7 l-4 16 L41 28 h-7 z" fill="#fde047"/></svg>`;

/** @param {string} body */
const page = (body) =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>StormCentral</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>html,body{height:100%;margin:0;background:#000;color:#a8acb3;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:0 24px}
h1{margin:0;font-size:15px;font-weight:600;color:#ececed}p{margin:0;max-width:420px}
a{display:inline-block;margin-top:6px;padding:7px 14px;border:1px solid #25282d;border-radius:6px;background:#16181b;color:#ececed;text-decoration:none}
a:hover{background:#1f2226}</style></head><body><main>${ICON}${body}</main></body></html>`);

const SPLASH = page(`<p>Starting StormCentral…</p>`);

/** @param {string} url @param {string} reason */
const offlinePage = (url, reason) =>
  page(
    `<h1>Can't reach StormCentral</h1><p>Check your internet connection. (${reason.replace(/[<>&"]/g, "")})</p><a href="${encodeURI(url)}">Try again</a>`,
  );

// ─── Window, menu and security ──────────────────────────────────────────────

/** @param {{ hidden: boolean }} opts */
function createWindow({ hidden }) {
  const stateFile = path.join(app.getPath("userData"), "window-state.json");
  const { bounds, maximized } = loadWindowState(stateFile);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 560,
    show: false,
    backgroundColor: "#000000",
    title: "StormCentral",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: PRELOAD,
      // The page's alert watcher must keep its timers running while the window is hidden in the tray.
      backgroundThrottling: false,
    },
  });
  if (hidden) {
    // maximize() would show the window, and an unseen window's bounds aren't worth saving.
    win.once("show", () => {
      if (maximized) win.maximize();
      trackWindowState(win, stateFile);
    });
  } else {
    if (maximized) win.maximize();
    trackWindowState(win, stateFile);
    win.once("ready-to-show", () => win.show());
  }
  win.on("close", (event) => {
    if (isQuitting || !keepsRunningInTray()) return;
    event.preventDefault();
    win.hide();
    showTrayHintOnce();
  });
  // Windows sign-out or shutdown: let the window close, or it would hold up the session ending.
  win.on("query-session-end", () => (isQuitting = true));
  win.on("session-end", () => (isQuitting = true));
  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED: a navigation replaced by another, not a failure.
    if (isMainFrame && code !== -3 && isAppUrl(url)) void win.loadURL(offlinePage(url, description));
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    log(`renderer gone: ${details.reason}`);
    if (details.reason !== "clean-exit" && !win.isDestroyed()) win.webContents.reload();
  });
  void win.loadURL(SPLASH);
  return win;
}

/** Shows and focuses the window, recreating it if it was ever really closed. */
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = openMainWindow({ hidden: false });
    if (appUrl) loadApp(mainWindow, appUrl);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** @param {{ hidden: boolean }} opts */
function openMainWindow(opts) {
  const win = createWindow(opts);
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

/** @param {BrowserWindow} win @param {string} url */
function loadApp(win, url) {
  // A failed load shows the offline page (did-fail-load), so it isn't fatal here.
  win.loadURL(url).catch((err) => log(`load failed: ${err instanceof Error ? err.message : err}`));
}

// ─── Tray, close to tray, sign-in launch ────────────────────────────────────

function keepsRunningInTray() {
  return tray !== null && settings.get().closeToTray;
}

/** @type {Notification | null} Held so its click handler outlives the call. */
let trayHint = null;

function showTrayHintOnce() {
  if (settings.get().trayHintShown) return;
  settings.update({ trayHintShown: true });
  if (!Notification.isSupported()) return;
  trayHint = new Notification({
    title: "StormCentral is still running",
    body: "It keeps checking for warnings. Quit from the tray icon.",
    icon: appIcon(),
    silent: true,
  });
  trayHint.on("click", showWindow);
  trayHint.show();
}

function quitFromTray() {
  isQuitting = true;
  app.quit();
}

/** Packaged Windows/macOS builds only: a dev build would register the bare Electron binary. */
const loginItemSupported = () => app.isPackaged && (process.platform === "win32" || process.platform === "darwin");

function currentSettings() {
  const s = publicSettings(settings.get());
  // Windows owns the truth: the user may have removed the entry in Task Manager or Settings.
  if (loginItemSupported()) s.launchAtLogin = app.getLoginItemSettings(LOGIN_ITEM).openAtLogin;
  return s;
}

/** @param {Partial<import("./settings.mjs").PublicSettings>} patch */
function applySettings(patch) {
  if (patch.launchAtLogin !== undefined) {
    if (loginItemSupported()) app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, ...LOGIN_ITEM });
    else log("settings: launch at sign-in only applies to installed Windows builds");
  }
  settings.update(patch);
  log(`settings: ${JSON.stringify(patch)}`);
  return currentSettings();
}

// ─── Bridge to the page (preload.cjs) ───────────────────────────────────────

/**
 * Only the app's own page, in the main window's top frame, may use the
 * bridge. The splash and offline pages share the preload but not the origin.
 * @param {import("electron").IpcMainEvent | import("electron").IpcMainInvokeEvent} event
 */
function fromApp(event) {
  const frame = event.senderFrame;
  return (
    mainWindow !== null &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    frame !== null &&
    frame.parent === null &&
    isAppUrl(frame.url)
  );
}

function registerIpc() {
  ipcMain.on(IPC.trayStatus, (event, payload) => {
    if (!fromApp(event)) return;
    const status = parseTrayStatus(payload);
    if (status) tray?.setStatus(status);
    else log("ipc: ignored an invalid tray status");
  });
  ipcMain.on(IPC.showWindow, (event) => {
    if (fromApp(event)) showWindow();
  });
  ipcMain.handle(IPC.getSettings, (event) => {
    if (!fromApp(event)) throw new Error("Not allowed");
    return currentSettings();
  });
  ipcMain.handle(IPC.setSettings, (event, payload) => {
    if (!fromApp(event)) throw new Error("Not allowed");
    const patch = parseSettingsPatch(payload);
    if (!patch) throw new Error("Invalid settings");
    return applySettings(patch);
  });
  ipcMain.handle(IPC.checkUpdates, (event) => {
    if (!fromApp(event)) throw new Error("Not allowed");
    return checkForUpdatesFromPage();
  });
  ipcMain.handle(IPC.installUpdate, (event) => {
    if (!fromApp(event)) throw new Error("Not allowed");
    return installUpdateFromPage();
  });
}

function hardenSessions() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isAppUrl(origin));
}

app.on("web-contents-created", (_e, contents) => {
  // Links to other sites open in the default browser; the window only ever shows the app.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) void contents.loadURL(url);
    else openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

function showAbout() {
  const win = mainWindow;
  const opts = /** @type {import("electron").MessageBoxOptions} */ ({
    type: "info",
    message: `StormCentral ${app.getVersion()}`,
    detail: `Open-data weather, NEXRAD radar and a community spotter network.\n\nElectron ${process.versions.electron} · ${REMOTE_URL ? `Server: ${REMOTE_URL}` : "Local server"}\nData folder: ${app.getPath("userData")}`,
  });
  void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "&File", submenu: [{ role: "quit" }] },
    {
      label: "&Edit",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    {
      label: "&View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Check for updates…", click: () => checkForUpdatesFromMenu() },
        { label: "Release notes", click: () => openExternal(`https://github.com/${REPO}/releases`) },
        { label: "Open logs folder", click: () => void shell.openPath(app.getPath("logs")) },
        { type: "separator" },
        { label: "About StormCentral", click: showAbout },
      ],
    },
  ]);
}

/** @param {number} code */
function onServerCrash(code) {
  log(`server crashed (code ${code})`);
  const opts = /** @type {import("electron").MessageBoxOptions} */ ({
    type: "error",
    buttons: ["Restart StormCentral", "Quit"],
    defaultId: 0,
    message: "StormCentral stopped unexpectedly",
    detail: `The local server exited (code ${code}). Details are in ${app.getPath("logs")}.`,
  });
  // A dialog parented to a window hidden in the tray could go unseen.
  const ask = mainWindow?.isVisible() ? dialog.showMessageBox(mainWindow, opts) : dialog.showMessageBox(opts);
  void ask.then(({ response }) => {
    // The user asked for it, so come back with a window even after a hidden sign-in launch.
    if (response === 0) app.relaunch({ args: process.argv.slice(1).filter((a) => a !== "--hidden") });
    app.exit(0);
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

async function start() {
  log(`StormCentral ${app.getVersion()} starting (${REMOTE_URL ? `remote ${REMOTE_URL}` : "local server"})`);
  hardenSessions();
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  mainWindow = openMainWindow({ hidden: START_HIDDEN });
  try {
    tray = createTray({ onOpen: showWindow, onCheckForUpdates: checkForUpdatesFromMenu, onQuit: quitFromTray, log });
  } catch (err) {
    // No tray (some Linux desktops): closing quits, and a hidden start would leave no way back in.
    log(`tray unavailable: ${err instanceof Error ? err.message : err}`);
    if (START_HIDDEN) mainWindow.show();
  }
  started = true;

  let url = REMOTE_URL;
  if (!url) {
    try {
      url = await startLocalServer({ log, onCrash: onServerCrash });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`startup failed: ${message}`);
      dialog.showErrorBox("StormCentral couldn't start", `${message}\n\nDetails are in ${app.getPath("logs")}.`);
      app.exit(1);
      return;
    }
  }
  appOrigin = new URL(url).origin;
  appUrl = url;
  if (mainWindow) loadApp(mainWindow, url);
  initAutoUpdates({ log });
}

if (process.platform === "win32") app.setAppUserModelId(APP_ID);
// stormcentral:// opens the app (the installer registers it too; this covers portable runs).
if (app.isPackaged) app.setAsDefaultProtocolClient("stormcentral");
// Let Chromium fall back to software WebGL when the GPU is missing or blocklisted
// (VMs, remote desktop), so the radar map still renders. Chrome gates this for the
// open web; it's fine here because the window only ever shows the app's own UI.
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching again (Start menu, desktop shortcut) brings back a window hidden in the tray.
  app.on("second-instance", (_e, argv) => {
    if (started && !argv.includes("--hidden")) showWindow();
  });
  // Every quit path ends here first (tray, File → Quit, electron-updater's quitAndInstall), so closing isn't turned into hiding.
  app.on("before-quit", () => (isQuitting = true));
  nativeUpdater.on("before-quit-for-update", () => (isQuitting = true));
  app.on("window-all-closed", () => {
    // A window hidden to the tray isn't closed, so this only runs once it's really gone.
    if (isQuitting || !keepsRunningInTray()) app.quit();
  });
  app.on("will-quit", () => tray?.destroy());
  void app.whenReady().then(start);
}
