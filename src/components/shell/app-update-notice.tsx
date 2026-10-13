"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { appUpdaterAvailable } from "@/lib/native/app-updater";
import { checkForUpdate, dismissUpdate, type AvailableUpdate } from "@/lib/native/app-update";
import { isNativeApp } from "@/lib/platform";
import { buttonClass, IconButton } from "../ui/button";
import { UpdateButton } from "./update-button";

/**
 * Android app only: offers the newest release when it is newer than the
 * installed app. 0.4.3+ updates in the app (Update); older apps open the APK
 * in the browser, which hands it to the package installer.
 */
export function AppUpdateNotice() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const inApp = useSyncExternalStore(
    () => () => {},
    appUpdaterAvailable,
    () => false,
  );

  useEffect(() => {
    if (!isNativeApp()) return;
    let live = true;
    checkForUpdate().then(
      (u) => live && setUpdate(u),
      () => {
        /* offline or rate-limited: try again next launch */
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (!update) return null;
  const dismiss = () => {
    dismissUpdate(update.version);
    setUpdate(null);
  };

  return (
    <div
      role="status"
      className="surface fixed inset-x-4 bottom-[calc(var(--tabbar-h)_+_12px)] z-50 flex items-center gap-3 py-2 pr-2 pl-3 md:inset-x-auto md:right-6 md:bottom-6 md:w-[380px]"
    >
      <Download className="size-4 shrink-0 text-ink-3" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-ink-2" aria-live="polite">
        {status ?? (
          <>
            <span className="font-medium text-ink">Storm Central {update.version}</span> is available.
          </>
        )}
      </p>
      {inApp ? (
        <UpdateButton version={update.version} onStatus={setStatus} />
      ) : (
        <a href={update.apkUrl} className={buttonClass("primary", "sm")}>
          Download
        </a>
      )}
      <IconButton label="Dismiss" size="sm" onClick={dismiss}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}
