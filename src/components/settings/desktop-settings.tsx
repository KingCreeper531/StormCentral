"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Panel } from "@/components/ui/panel";
import { Skeleton, Toggle } from "@/components/ui/misc";
import { useT } from "@/lib/i18n/use-t";
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
  const t = useT();

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
      ? t("Start Storm Central when you sign in to Windows")
      : bridge.platform === "darwin"
        ? t("Start Storm Central when you log in")
        : null;

  // A Mac app stays in the Dock and menu bar; "tray" is a Windows word.
  const mac = bridge.platform === "darwin";

  return (
    <Panel title={t("Desktop app")}>
      {settings ? (
        <div className="divide-y divide-line">
          <Toggle
            label={mac ? t("Keep running when the window is closed") : t("Keep running in the tray when the window is closed")}
            checked={settings.closeToTray}
            onChange={(closeToTray) => change({ closeToTray })}
          />
          {loginLabel && settings.launchAtLoginSupported !== false && (
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
        <p className="mt-2 text-xs text-ink-3">
          {mac
            ? t("With the window closed, Storm Central keeps checking for warnings. Quit from the menu bar icon or with ⌘Q.")
            : t("With the window closed, Storm Central keeps checking for warnings. Quit from the tray icon.")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-ink-2">
          {error === "save" ? t("Couldn't save that setting. Try again.") : t("Couldn't load the desktop app settings.")}
        </p>
      )}
    </Panel>
  );
}
