"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Panel } from "@/components/ui/panel";
import { Skeleton, Toggle } from "@/components/ui/misc";
import { desktopBridge, type DesktopSettings as Settings } from "@/lib/native/desktop";

const noSubscribe = () => () => {};

/**
 * Desktop app only: tray and sign-in preferences, stored by the desktop
 * shell (not in the page). Renders nothing on the web and on Android.
 */
export function DesktopSettings() {
  // null on the server and during hydration, so the markup matches; the bridge once on the client.
  const bridge = useSyncExternalStore(noSubscribe, desktopBridge, () => null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<"load" | "save" | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.getSettings().then(
      (s) => live && setSettings(s),
      () => live && setError("load"),
    );
    return () => {
      live = false;
    };
  }, [bridge]);

  if (!bridge) return null;

  const change = (patch: Partial<Settings>) => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setError(null);
    bridge.setSettings(patch).then(setSettings, () => {
      setSettings(previous);
      setError("save");
    });
  };

  // Sign-in launch is a Windows (and macOS) login item; Linux builds have no equivalent.
  const loginLabel =
    bridge.platform === "win32"
      ? "Start StormCentral when you sign in to Windows"
      : bridge.platform === "darwin"
        ? "Start StormCentral when you log in"
        : null;

  return (
    <Panel title="Desktop app">
      {settings ? (
        <div className="divide-y divide-line">
          <Toggle
            label="Keep running in the tray when the window is closed"
            checked={settings.closeToTray}
            onChange={(closeToTray) => change({ closeToTray })}
          />
          {loginLabel && (
            <Toggle label={loginLabel} checked={settings.launchAtLogin} onChange={(launchAtLogin) => change({ launchAtLogin })} />
          )}
        </div>
      ) : (
        error !== "load" && (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-10" />
            {loginLabel && <Skeleton className="h-10" />}
          </div>
        )
      )}
      {settings?.closeToTray && (
        <p className="mt-2 text-xs text-ink-3">With the window closed, StormCentral keeps checking for warnings. Quit from the tray icon.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-ink-2">
          {error === "save" ? "Couldn't save that setting. Try again." : "Couldn't load the desktop app settings."}
        </p>
      )}
    </Panel>
  );
}
