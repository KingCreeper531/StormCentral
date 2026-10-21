"use client";

import { useEffect } from "react";
import { useSession } from "@/hooks/queries";
import { startSync, stopSync, syncOnFor } from "@/lib/sync/client";

/** Keeps settings in step with the account while someone is signed in and has sync on here (lib/sync/client). */
export function useSettingsSync() {
  const userId = useSession().data?.id ?? null;
  useEffect(() => {
    if (!syncOnFor(userId)) return;
    startSync();
    return stopSync;
  }, [userId]);
}
