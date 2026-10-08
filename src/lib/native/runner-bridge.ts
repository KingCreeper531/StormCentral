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

export async function syncRunner(config: WatchConfig, widget: WidgetSnapshot | null) {
  await (await runner()).dispatchEvent({ label: RUNNER_LABEL, event: "sync", details: { config, widget } });
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
