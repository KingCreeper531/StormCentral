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

/** Fired on window whenever the app asks for, or learns, a new notification permission. */
export const PERMISSION_EVENT = "stormcentral:notify-permission";
export const announcePermission = () => window.dispatchEvent(new Event(PERMISSION_EVENT));

export async function requestWebPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!webNotificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  const p = await Notification.requestPermission();
  announcePermission();
  return p;
}

/**
 * Re-reads permission when it may have changed: after our own prompts, when
 * the user changes it in site settings (Permissions API), and on focus.
 */
export function subscribePermission(cb: () => void) {
  window.addEventListener(PERMISSION_EVENT, cb);
  window.addEventListener("focus", cb);
  let status: PermissionStatus | null = null;
  void navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((s) => {
      status = s;
      s.addEventListener("change", cb);
    })
    .catch(() => {});
  return () => {
    window.removeEventListener(PERMISSION_EVENT, cb);
    window.removeEventListener("focus", cb);
    status?.removeEventListener("change", cb);
  };
}

/** Shows a notification; clicking it brings the app (or the hidden desktop window) forward. */
export function showWebNotification(n: AppNotification) {
  if (webPermission() !== "granted") return;
  const options: NotificationOptions = {
    body: n.body,
    tag: `stormcentral-${n.id}`,
    icon: "/icon.svg",
    requireInteraction: n.kind === "warning",
  };
  try {
    const note = new Notification(n.title, options);
    note.onclick = () => {
      window.focus();
      (window as { stormcentralDesktop?: { showWindow?: () => void } }).stormcentralDesktop?.showWindow?.();
      note.close();
    };
  } catch {
    // Mobile browsers (Chrome on Android) only allow notifications through the service worker.
    void navigator.serviceWorker?.ready.then((reg) => reg.showNotification(n.title, options)).catch(() => {});
  }
}
