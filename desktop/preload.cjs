// @ts-check
"use strict";
/**
 * The page's only door into the desktop shell: `window.stormcentralDesktop`.
 * The window is sandboxed, so this is CommonJS and may only require
 * "electron". Arguments are copied field by field (nothing else crosses),
 * and the main process validates them again and checks the sender's origin.
 */
// A sandboxed preload can't use ES modules; require("electron") is its only import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL = {
  trayStatus: "stormcentral:tray-status",
  showWindow: "stormcentral:show-window",
  getSettings: "stormcentral:get-settings",
  setSettings: "stormcentral:set-settings",
  checkUpdates: "stormcentral:check-updates",
  installUpdate: "stormcentral:install-update",
};

/** @param {unknown} v */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

contextBridge.exposeInMainWorld("stormcentralDesktop", {
  platform: process.platform,

  /** @param {{ text: string, tooltip: string, iconDataUrl?: string }} status */
  setTrayStatus(status) {
    if (!isObject(status)) return;
    const { text, tooltip, iconDataUrl } = status;
    if (typeof text !== "string" || typeof tooltip !== "string") return;
    if (iconDataUrl !== undefined && typeof iconDataUrl !== "string") return;
    ipcRenderer.send(CHANNEL.trayStatus, iconDataUrl === undefined ? { text, tooltip } : { text, tooltip, iconDataUrl });
  },

  showWindow() {
    ipcRenderer.send(CHANNEL.showWindow);
  },

  /** Checks GitHub Releases now. @returns {Promise<{ state: string, current: string, latest: string | null }>} */
  checkForUpdates() {
    return ipcRenderer.invoke(CHANNEL.checkUpdates);
  },

  /** Restarts into a downloaded update. @returns {Promise<boolean>} */
  installUpdate() {
    return ipcRenderer.invoke(CHANNEL.installUpdate);
  },

  /** @returns {Promise<{ closeToTray: boolean, launchAtLogin: boolean }>} */
  getSettings() {
    return ipcRenderer.invoke(CHANNEL.getSettings);
  },

  /** @param {{ closeToTray?: boolean, launchAtLogin?: boolean }} partial */
  setSettings(partial) {
    if (!isObject(partial)) return Promise.reject(new TypeError("setSettings expects an object"));
    /** @type {Record<string, boolean>} */
    const patch = {};
    for (const key of /** @type {const} */ (["closeToTray", "launchAtLogin"])) {
      const value = partial[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") return Promise.reject(new TypeError(`${key} must be a boolean`));
      patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return ipcRenderer.invoke(CHANNEL.getSettings);
    return ipcRenderer.invoke(CHANNEL.setSettings, patch);
  },
});
