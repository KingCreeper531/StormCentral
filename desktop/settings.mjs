// @ts-check
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Desktop-only preferences, kept in `userData/settings.json`. Reads and
 * writes never throw: a missing, unreadable or hand-edited file falls back to
 * the defaults field by field.
 */

/** @typedef {{ closeToTray: boolean, launchAtLogin: boolean }} PublicSettings What the page may read and change. */
/** @typedef {PublicSettings & { trayHintShown: boolean }} Settings */

/** @type {readonly (keyof PublicSettings)[]} */
const PUBLIC_KEYS = ["closeToTray", "launchAtLogin"];

/** @returns {Settings} */
function defaults() {
  return {
    // Windows users expect tray apps; elsewhere a hidden window may have no tray to come back from.
    closeToTray: process.platform === "win32",
    launchAtLogin: false,
    trayHintShown: false,
  };
}

/** @param {string} file @returns {Settings} */
function read(file) {
  const base = defaults();
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return base; // first launch or unreadable
  }
  if (!raw || typeof raw !== "object") return base;
  /** @type {Settings} */
  const out = { ...base };
  for (const key of /** @type {(keyof Settings)[]} */ (Object.keys(base))) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

/** @param {string} file @param {Settings} value */
function write(file, value) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename, so a crash mid-write never leaves a truncated file.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a settings change from the page: a plain object whose keys are
 * all public settings with boolean values. Returns null if anything is off.
 * @param {unknown} payload
 * @returns {Partial<PublicSettings> | null}
 */
export function parseSettingsPatch(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entries = Object.entries(payload);
  if (entries.length === 0 || entries.length > PUBLIC_KEYS.length) return null;
  /** @type {Partial<PublicSettings>} */
  const patch = {};
  for (const [key, value] of entries) {
    if (!PUBLIC_KEYS.includes(/** @type {keyof PublicSettings} */ (key)) || typeof value !== "boolean") return null;
    patch[/** @type {keyof PublicSettings} */ (key)] = value;
  }
  return patch;
}

/**
 * @param {string} file
 * @param {{ log: (m: string) => void }} opts
 */
export function openSettings(file, { log }) {
  let current = read(file);
  return {
    /** @returns {Settings} */
    get: () => ({ ...current }),
    /** @param {Partial<Settings>} patch @returns {Settings} */
    update(patch) {
      current = { ...current, ...patch };
      if (!write(file, current)) log(`settings: couldn't write ${file}`);
      return { ...current };
    },
  };
}

/** @param {Settings} s @returns {PublicSettings} */
export function publicSettings(s) {
  return { closeToTray: s.closeToTray, launchAtLogin: s.launchAtLogin };
}
