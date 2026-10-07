// @ts-check
/**
 * StormCentral for Windows. An Electron window around the app's own Next.js
 * server, which runs locally (server.mjs), so every feature works with no
 * hosting: radar, all modes, and accounts and reports stored on this PC.
 *
 * A build can instead point at a hosted StormCentral (STORMCENTRAL_URL at
 * build time, baked into package.json by electron-builder.config.mjs), so all
 * users share one spotter network. Updates come from GitHub Releases.
 */
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { createLog } from "./log.mjs";
import { startLocalServer } from "./server.mjs";
import { checkForUpdatesFromMenu, initAutoUpdates } from "./updater.mjs";
import { loadWindowState, trackWindowState } from "./window-state.mjs";

const require = createRequire(import.meta.url);
/** @type {{ stormcentral?: { remoteUrl?: string | null, repo?: string } }} */
const meta = require("./package.json");

const APP_ID = "io.github.kingcreeper531.stormcentral";
const REPO = meta.stormcentral?.repo || "KingCreeper531/StormCentral";
const REMOTE_URL = httpsUrl(meta.stormcentral?.remoteUrl);
/** Permissions the UI may use: "Use my location", copying share links, map fullscreen. */
const ALLOWED_PERMISSIONS = new Set(["geolocation", "clipboard-sanitized-write", "fullscreen"]);

const log = createLog(path.join(app.getPath("logs"), "main.log"));
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** Origin the UI is served from; anything else opens in the default browser. */
let appOrigin = "";

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

function createWindow() {
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
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (maximized) win.maximize();
  trackWindowState(win, stateFile);
  win.once("ready-to-show", () => win.show());
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
  const ask = mainWindow ? dialog.showMessageBox(mainWindow, opts) : dialog.showMessageBox(opts);
  void ask.then(({ response }) => {
    if (response === 0) app.relaunch();
    app.exit(0);
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

async function start() {
  log(`StormCentral ${app.getVersion()} starting (${REMOTE_URL ? `remote ${REMOTE_URL}` : "local server"})`);
  hardenSessions();
  Menu.setApplicationMenu(buildMenu());
  mainWindow = createWindow();
  mainWindow.on("closed", () => (mainWindow = null));

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
  // A failed load shows the offline page (did-fail-load), so it isn't fatal here.
  mainWindow?.loadURL(url).catch((err) => log(`initial load failed: ${err instanceof Error ? err.message : err}`));
  initAutoUpdates({ log });
}

if (process.platform === "win32") app.setAppUserModelId(APP_ID);
// Let Chromium fall back to software WebGL when the GPU is missing or blocklisted
// (VMs, remote desktop), so the radar map still renders. Chrome gates this for the
// open web; it's fine here because the window only ever shows the app's own UI.
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(start);
}
