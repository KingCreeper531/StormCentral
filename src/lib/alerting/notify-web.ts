"use client";

import type { AppNotification } from "./types";

/**
 * Browser notifications (web and the Windows app). Android uses the
 * background runner's native notifications instead (lib/native/runner-bridge).
 */
export const webNotificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

export function webPermission(): NotificationPermission | "unsupported" {
  return webNotificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestWebPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!webNotificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

/** Shows a notification; clicking it brings the app (or the hidden desktop window) forward. */
export function showWebNotification(n: AppNotification) {
  if (webPermission() !== "granted") return;
  const note = new Notification(n.title, {
    body: n.body,
    tag: `stormcentral-${n.id}`,
    icon: "/icon.svg",
    requireInteraction: n.kind === "warning",
  });
  note.onclick = () => {
    window.focus();
    (window as { stormcentralDesktop?: { showWindow?: () => void } }).stormcentralDesktop?.showWindow?.();
    note.close();
  };
}
