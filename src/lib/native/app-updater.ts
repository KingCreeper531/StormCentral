"use client";

/**
 * In-app updates on Android (android/.../AppUpdaterPlugin.java): downloads
 * the newest APK and installs it through Android's PackageInstaller, the way
 * app stores do. Android asks to confirm the first time; on Android 12+ later
 * updates install on their own. Apps installed before 0.4.3 don't have it;
 * callers check {@link appUpdaterAvailable} and fall back to the APK link.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface UpdaterStatus {
  /** StormCentral may install apps ("Install unknown apps" is allowed). */
  canInstall: boolean;
  /** Android will install updates without a confirmation screen. */
  silent: boolean;
  /** Install updates automatically in the background (default on). */
  auto: boolean;
  state: "downloading" | "installing" | "confirm" | "installed" | "failed" | null;
  error: string | null;
}

interface AppUpdaterPlugin {
  status(): Promise<UpdaterStatus>;
  setAuto(o: { enabled: boolean }): Promise<void>;
  openInstallPermission(): Promise<void>;
  install(): Promise<{ version: string; silent: boolean }>;
  addListener(event: "progress", cb: (p: { percent: number }) => void): Promise<PluginListenerHandle>;
}

export const appUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");

export const appUpdaterAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("AppUpdater");

/** Downloads and starts installing the update; `onProgress` gets 0–100 (or -1 when the size is unknown). */
export async function installUpdate(onProgress: (percent: number) => void) {
  const sub = await appUpdater.addListener("progress", (p) => onProgress(p.percent));
  try {
    return await appUpdater.install();
  } finally {
    await sub.remove();
  }
}
