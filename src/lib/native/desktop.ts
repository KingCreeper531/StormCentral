/**
 * The Windows and Mac apps' bridge (`window.stormcentralDesktop`, exposed by
 * desktop/preload.cjs). Absent on the web and in the Android app, so every
 * caller goes through desktopBridge() and handles null.
 */

export type DesktopPlatform = "win32" | "darwin" | "linux";

export interface DesktopSettings {
  /** Closing the window hides it to the tray; the page keeps running. */
  closeToTray: boolean;
  /** Start hidden in the tray when the user signs in (installed Windows and Mac builds). */
  launchAtLogin: boolean;
  /** False in the Microsoft Store version, which can't add itself to startup. Missing in older apps (supported). */
  launchAtLoginSupported?: boolean;
}

export interface TrayStatus {
  /** Short status, e.g. "76°F" (shown beside the icon on macOS). At most 200 characters. */
  text: string;
  /** Hover text, e.g. "Norman, OK · 76°F, thunderstorm". At most 200 characters (Windows shows 127). */
  tooltip: string;
  /**
   * Square PNG data URL, 16–64 px (32 px recommended), under 64 KB. Omit it to
   * show the app icon. macOS shows `text` (and `badge`) instead.
   */
  iconDataUrl?: string;
  /**
   * An active warning at the location: the colour of the dot on the icon (red:
   * tornado or emergency, orange: other warnings). Shown beside the text on
   * macOS. Apps from before the Mac app ignore it.
   */
  badge?: "red" | "orange";
}

export interface DesktopUpdateStatus {
  /**
   * current: up to date. downloading: a newer version is on its way. ready:
   * restart to install. available (Mac app): a newer version is out to
   * download from `downloadUrl`. store: the Microsoft Store updates it.
   */
  state: "current" | "downloading" | "ready" | "available" | "error" | "unsupported" | "store";
  current: string;
  latest: string | null;
  /** With "available": the new version's .dmg, or its release page (https). */
  downloadUrl?: string;
}

export interface DesktopBridge {
  readonly platform: DesktopPlatform;
  setTrayStatus(status: TrayStatus): void;
  /** Shows and focuses the window, e.g. when it is hidden in the tray. */
  showWindow(): void;
  getSettings(): Promise<DesktopSettings>;
  /** Resolves with the settings as applied. */
  setSettings(partial: Partial<DesktopSettings>): Promise<DesktopSettings>;
  /** Missing in app builds older than 0.1.2. */
  checkForUpdates?(): Promise<DesktopUpdateStatus>;
  /** Restarts into a downloaded update (the Mac app opens the new version's download instead). */
  installUpdate?(): Promise<boolean>;
}

function isBridge(value: unknown): value is DesktopBridge {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.platform === "string" &&
    typeof b.setTrayStatus === "function" &&
    typeof b.showWindow === "function" &&
    typeof b.getSettings === "function" &&
    typeof b.setSettings === "function"
  );
}

/** The desktop bridge, or null outside the desktop apps (and during server rendering). */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const value = (window as { stormcentralDesktop?: unknown }).stormcentralDesktop;
  return isBridge(value) ? value : null;
}
