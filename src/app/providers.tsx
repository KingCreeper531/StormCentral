"use client";

import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { AlertWatcher } from "@/components/alerts/alert-watcher";
import { DesktopTraySync } from "@/components/shell/desktop-tray-sync";
import { LocationFollower } from "@/components/shell/location-follower";
import { ChaserBeacon } from "@/components/community/chaser-beacon";
import { isTransient, retryDelay } from "@/lib/api/http";
import { COMMUNITY_ENABLED, IS_STATIC_BUNDLE } from "@/lib/platform";
import { themeVars } from "@/lib/addons/manifest";
import { applyCustomVars, applyTheme, resolveTheme } from "@/lib/theme";
import { selectActiveTheme, useAddonsStore } from "@/store/addons-store";
import { useAlertsStore } from "@/store/alerts-store";
import { useChaserStore } from "@/store/chaser-store";
import { sunPosition } from "@/lib/astro/sun";
import { useLang } from "@/lib/i18n/use-t";
import { useAppStore } from "@/store/app-store";

/** Only small, location-scoped feeds are persisted for instant cold starts. */
const PERSISTED = new Set(["forecast", "air", "kp", "climate"]);

/** The browser's local storage; undefined on the server and when site data is blocked (reading it throws then). */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

interface RestorableStore {
  persist?: { rehydrate: () => unknown };
  setState: (partial: { hydrated: boolean }) => unknown;
}

/**
 * Restores the stores' saved settings. With no storage, zustand gives a store
 * no persist API: it keeps its defaults and counts as restored, so the app
 * still renders.
 */
export function restoreStores(stores: readonly RestorableStore[] = [useAppStore, useAlertsStore, useAddonsStore, useChaserStore]) {
  for (const store of stores) {
    if (store.persist) void store.persist.rehydrate();
    else store.setState({ hydrated: true });
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            refetchIntervalInBackground: false,
            // Busy or unreachable services get a few tries with backoff; bad params and 404s don't.
            retry: (count, err) => count < 4 && isTransient(err),
            retryDelay,
            gcTime: 30 * 60_000,
          },
        },
      }),
  );
  // With no storage (SSR) this is a no-op persister, so the tree is identical on both sides.
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: browserStorage(),
      key: "stormcentral:queries",
      throttleTime: 2000,
    }),
  );

  useEffect(() => {
    restoreStores();
    // Not in the Android bundle: its assets come from the app's local file server.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production" && !IS_STATIC_BUNDLE) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* radar still works, just without the persistent tile cache */
      });
    }
  }, []);

  // Keep the document's theme in step with the setting (and the OS, for "system").
  // A custom theme from GitHub wins: its base picks light or dark.
  const themePref = useAppStore((s) => s.theme);
  const hydrated = useAppStore((s) => s.hydrated);
  const custom = useAddonsStore(selectActiveTheme);
  const addonsHydrated = useAddonsStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated || !addonsHydrated) return;
    applyCustomVars(custom ? themeVars(custom) : null);
    // Vivid-sky themes switch on the bright animated sky (weather-background, globals.css).
    if (custom?.sky) document.documentElement.dataset.sky = custom.sky;
    else delete document.documentElement.dataset.sky;
    if (custom?.followSun) {
      // Light while the sun is up at the selected location (civil twilight counts as day), dark at night.
      const apply = () => {
        const { lat, lon } = useAppStore.getState().location;
        applyTheme(sunPosition(new Date(), lat, lon).altitude > -6 ? "light" : "dark");
      };
      apply();
      const id = setInterval(apply, 5 * 60_000);
      const unsub = useAppStore.subscribe((s, prev) => s.location !== prev.location && apply());
      return () => {
        clearInterval(id);
        unsub();
      };
    }
    if (custom) {
      applyTheme(custom.base, custom.colors.canvas);
      return;
    }
    applyTheme(resolveTheme(themePref));
    if (themePref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme(resolveTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themePref, hydrated, custom, addonsHydrated]);

  // <html lang> follows the app language (screen readers and hyphenation use it).
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Three days: with no signal the saved forecast still covers the days ahead (the Daily page labels it as saved).
        maxAge: 72 * 3_600_000,
        // Bump when a persisted query's shape changes, so data saved by an older version is dropped.
        buster: "v2",
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === "success" && PERSISTED.has(String(q.queryKey[0])),
        },
      }}
    >
      <MotionConfig reducedMotion="user">
        {children}
        {/* Headless: warning/custom-alert checks and the Windows tray temperature. */}
        <AlertWatcher />
        <DesktopTraySync />
        <LocationFollower />
        {COMMUNITY_ENABLED && <ChaserBeacon />}
      </MotionConfig>
    </PersistQueryClientProvider>
  );
}
