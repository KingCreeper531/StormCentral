"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useBroadcastStore } from "@/store/broadcast-store";

const BOOTED = "stormcentral:booted-broadcast";

/**
 * Whether opening the app goes straight to Broadcast mode: the setting is on,
 * this tab hasn't done it already (so leaving Broadcast mode or coming back
 * from Settings stays in the app), and the link doesn't ask for a mode of its
 * own (?mode=…, as leaving Broadcast mode does).
 */
export function shouldBootBroadcast(boot: boolean, search: string, booted: boolean): boolean {
  return boot && !booted && !new URLSearchParams(search).has("mode");
}

/** Sends the app to /broadcast on start when Settings says to boot into it. */
export function useBootBroadcast() {
  const router = useRouter();
  useEffect(() => {
    let booted = false;
    try {
      booted = sessionStorage.getItem(BOOTED) === "1";
      sessionStorage.setItem(BOOTED, "1");
    } catch {
      // No session storage (private mode): booting once per load is still right.
    }
    if (shouldBootBroadcast(useBroadcastStore.getState().boot, window.location.search, booted)) router.replace("/broadcast");
  }, [router]);
}
