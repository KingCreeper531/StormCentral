"use client";

import type { AppNotification } from "./types";

/**
 * Android notifications from the open app, through Capacitor Local
 * Notifications: immediate, with a proper Android 13+ permission prompt and a
 * high-importance channel so warnings pop up. While the app is closed, the
 * background runner (src/native/runner) notifies instead.
 */
const WARNINGS_CHANNEL = "warnings";
const ALERTS_CHANNEL = "alerts";

async function plugin() {
  return (await import("@capacitor/local-notifications")).LocalNotifications;
}

let channels: Promise<void> | null = null;
function ensureChannels() {
  channels ??= plugin()
    .then(async (ln) => {
      await ln.createChannel({ id: WARNINGS_CHANNEL, name: "Weather warnings", description: "NWS warnings for your places", importance: 5, visibility: 1, vibration: true });
      await ln.createChannel({ id: ALERTS_CHANNEL, name: "Custom alerts", description: "Your custom weather alerts", importance: 4, visibility: 1 });
    })
    .catch(() => {
      channels = null; // try again next time
    });
  return channels;
}

export type NativePermission = "granted" | "denied" | "default";

export async function nativePermission(request: boolean): Promise<NativePermission> {
  const ln = await plugin();
  const s = request ? await ln.requestPermissions() : await ln.checkPermissions();
  return s.display === "granted" ? "granted" : s.display === "denied" ? "denied" : "default";
}

export async function showNativeNotification(n: AppNotification) {
  await ensureChannels();
  const ln = await plugin();
  await ln.schedule({
    notifications: [
      {
        id: n.id,
        title: n.title,
        body: n.body,
        largeBody: n.body,
        smallIcon: "ic_stat_stormcentral",
        iconColor: "#5b9cf6",
        autoCancel: true,
        channelId: n.kind === "warning" ? WARNINGS_CHANNEL : ALERTS_CHANNEL,
        group: n.kind === "warning" ? "warnings" : "alerts",
      },
    ],
  });
}
