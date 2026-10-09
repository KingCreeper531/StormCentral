"use client";

import type { WidgetSnapshot } from "../alerting/engine";
import type { WatchConfig } from "../alerting/types";

/**
 * Android only: hands the alert configuration to the background runner, which
 * checks warnings and custom alerts about every 15 minutes even while the app
 * is closed, and keeps the home-screen widget's data fresh.
 *
 * Must match `RUNNER_LABEL` in capacitor.config.ts (tested in runner-bridge.test.ts).
 */
export const RUNNER_LABEL = "io.github.kingcreeper531.stormcentral.alerts";

async function runner() {
  return (await import("@capacitor/background-runner")).BackgroundRunner;
}

/**
 * Writes straight to the runner's storage (SharedPreferences named after
 * RUNNER_LABEL), which the background runner and the home-screen widget both
 * read. This doesn't depend on the runner's JavaScript being up.
 */
async function writeShared(entries: Record<string, string>) {
  const { Preferences } = await import("@capacitor/preferences");
  await Preferences.configure({ group: RUNNER_LABEL });
  for (const [key, value] of Object.entries(entries)) await Preferences.set({ key, value });
}

export async function syncRunner(config: WatchConfig, widget: WidgetSnapshot | null) {
  const entries: Record<string, string> = { config: JSON.stringify(config) };
  if (widget) entries.widget = JSON.stringify(widget);
  const direct = writeShared(entries);
  const viaRunner = (await runner()).dispatchEvent({ label: RUNNER_LABEL, event: "sync", details: { config, widget } });
  // Either path is enough; only fail when both do.
  const [a, b] = await Promise.allSettled([direct, viaRunner]);
  if (a.status === "rejected" && b.status === "rejected") throw a.reason;
}

/** Run a check now (the app is open, so don't wait for the next scheduled run). */
export async function runnerCheck() {
  await (await runner()).dispatchEvent({ label: RUNNER_LABEL, event: "check", details: {} });
}

export async function runnerTestNotification() {
  await (await runner()).dispatchEvent({ label: RUNNER_LABEL, event: "test", details: {} });
}

export async function runnerPermission(request: boolean): Promise<string> {
  const r = await runner();
  const status = request ? await r.requestPermissions({ apis: ["notifications"] }) : await r.checkPermissions();
  return (status as { notifications?: string }).notifications ?? "prompt";
}
