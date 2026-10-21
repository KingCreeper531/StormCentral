// @ts-check
import { Menu, nativeImage, Tray } from "electron";
import { fileURLToPath } from "node:url";

/**
 * The notification-area icon. It shows the current temperature (the page
 * draws the image and sends it over IPC, see parseTrayStatus) and is how a
 * window hidden by "close to tray" comes back.
 *
 * On macOS it's a menu bar item instead: a monochrome bolt (a template image,
 * so macOS tints it for light and dark menu bars) with the temperature as
 * text beside it, in the system font, rather than the page's drawn digits.
 */

const IS_MAC = process.platform === "darwin";

/** @param {string} name */
const asset = (name) => fileURLToPath(new URL(`./assets/${name}`, import.meta.url));

/**
 * 16 px tray icon (Electron picks up tray@2x.png beside it); Linux trays are
 * larger, so they get the 32 px icon. macOS gets the 16 pt template bolt,
 * trayTemplate.png and trayTemplate@2x.png ("Template" in the name makes it
 * a template image).
 */
const TRAY_ICON = asset(process.platform === "linux" ? "icon.png" : IS_MAC ? "trayTemplate.png" : "tray.png");
/** 32 px app icon (and icon@2x.png) for notifications. */
const APP_ICON = asset("icon.png");

const MAX_TEXT = 200;
const MAX_DATA_URL = 64 * 1024;
const PNG_PREFIX = "data:image/png;base64,";
/** Windows caps notification-area tooltips at 127 characters. */
const MAX_TOOLTIP = process.platform === "win32" ? 127 : MAX_TEXT;

/**
 * badge: an active warning at the location, by the colour of the dot the
 * drawn icon carries (red: tornado or emergency, orange: other warnings).
 * @typedef {{ text: string, tooltip: string, iconDataUrl?: string, badge?: "red" | "orange" }} TrayStatus
 */
/** macOS shows the warning beside the temperature, since it doesn't use the drawn icon. */
const BADGE_MARK = { red: "🔴", orange: "🟠" };

/** @param {unknown} v @returns {v is string} */
const isText = (v) => typeof v === "string" && v.length <= MAX_TEXT;
/** Control characters out (newlines stay: Windows shows multi-line tooltips). @param {string} s */
const clean = (s) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();

/**
 * Width and height from a PNG's IHDR chunk, read before decoding, so a tiny
 * file that inflates to a huge bitmap is refused up front.
 * @param {Buffer} buf
 */
function pngSize(buf) {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || SIGNATURE.some((b, i) => buf[i] !== b) || buf.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Validates a tray status from the page. The icon, when present, must be a
 * square PNG data URL (16–64 px, under 64 KB), and the badge "red" or
 * "orange". Returns null if anything is off.
 * @param {unknown} payload
 * @returns {TrayStatus | null}
 */
export function parseTrayStatus(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { text, tooltip, iconDataUrl, badge } = /** @type {Record<string, unknown>} */ (payload);
  if (!isText(text) || !isText(tooltip)) return null;
  /** @type {TrayStatus} */
  const status = { text: clean(text), tooltip: clean(tooltip) };
  if (badge !== undefined) {
    if (badge !== "red" && badge !== "orange") return null;
    status.badge = badge;
  }
  if (iconDataUrl !== undefined) {
    if (typeof iconDataUrl !== "string" || iconDataUrl.length >= MAX_DATA_URL || !iconDataUrl.startsWith(PNG_PREFIX)) return null;
    const b64 = iconDataUrl.slice(PNG_PREFIX.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
    const size = pngSize(Buffer.from(b64, "base64"));
    if (!size || size.width !== size.height || size.width < 16 || size.width > 64) return null;
    status.iconDataUrl = iconDataUrl;
  }
  return status;
}

/** The app icon as a NativeImage (for notifications). */
export function appIcon() {
  return nativeImage.createFromPath(APP_ICON);
}

/** @type {Tray | null} Module-level so the icon is never garbage-collected. */
let tray = null;

/**
 * @param {{ onOpen: () => void, onCheckForUpdates: () => void, onQuit: () => void, log: (m: string) => void }} opts
 */
export function createTray({ onOpen, onCheckForUpdates, onQuit, log }) {
  const defaultImage = nativeImage.createFromPath(TRAY_ICON);
  if (defaultImage.isEmpty()) log(`tray: couldn't load ${TRAY_ICON}`);
  if (IS_MAC) defaultImage.setTemplateImage(true);
  const icon = new Tray(defaultImage);
  tray = icon;
  icon.setToolTip("Storm Central");
  icon.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Storm Central", click: onOpen },
      { label: "Check for updates…", click: onCheckForUpdates },
      { type: "separator" },
      { label: "Quit", click: onQuit },
    ]),
  );
  // macOS opens the menu on a click (and would also report the click), as menu bar items do.
  if (!IS_MAC) {
    icon.on("click", onOpen);
    icon.on("double-click", onOpen);
  }

  let lastTooltip = "";
  let lastText = "";
  /** "" = the default icon. */
  let lastIcon = "";

  return {
    /**
     * Updates the tooltip (and, on macOS, the text beside the icon). With an
     * icon the tray shows it; without one it goes back to the app icon.
     * macOS keeps its template icon and shows the text, plus a coloured dot
     * for a warning.
     * @param {TrayStatus} status a value returned by parseTrayStatus
     */
    setStatus(status) {
      if (icon.isDestroyed()) return;
      const tooltip = (status.tooltip || "Storm Central").slice(0, MAX_TOOLTIP);
      if (tooltip !== lastTooltip) icon.setToolTip((lastTooltip = tooltip));
      if (IS_MAC) {
        const title = [status.badge ? BADGE_MARK[status.badge] : "", status.text].filter(Boolean).join(" ");
        // Digits of equal width, so the menu bar doesn't shift as the temperature changes.
        if (title !== lastText) icon.setTitle((lastText = title), { fontType: "monospacedDigit" });
        return;
      }

      const next = status.iconDataUrl ?? "";
      if (next === lastIcon) return;
      if (!next) {
        icon.setImage(defaultImage);
        lastIcon = "";
        return;
      }
      // A 32 px image is the 2x form of a 16 px tray icon: Windows then
      // downsamples it cleanly at 100–175 % scaling instead of upscaling.
      const size = pngSize(Buffer.from(next.slice(PNG_PREFIX.length), "base64"));
      const image = nativeImage.createEmpty();
      image.addRepresentation({ scaleFactor: (size?.width ?? 16) / 16, dataURL: next });
      if (image.isEmpty()) {
        log("tray: ignored an icon that didn't decode");
        return;
      }
      icon.setImage(image);
      lastIcon = next;
    },
    destroy() {
      if (!icon.isDestroyed()) icon.destroy();
      if (tray === icon) tray = null;
    },
  };
}
