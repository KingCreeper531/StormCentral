"use client";

import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { HttpError } from "@/lib/api/http";
import { useAppStore } from "@/store/app-store";

/** Only small, location-scoped feeds are persisted for instant cold starts. */
const PERSISTED = new Set(["forecast", "air", "kp"]);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            refetchIntervalInBackground: false,
            // Client errors (bad params, 404) won't fix themselves on retry.
            retry: (count, err) => count < 2 && !(err instanceof HttpError && err.status >= 400 && err.status < 500),
            gcTime: 30 * 60_000,
          },
        },
      }),
  );
  // With no storage (SSR) this is a no-op persister, so the tree is identical on both sides.
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      key: "stormcentral:queries",
      throttleTime: 2000,
    }),
  );

  useEffect(() => {
    void useAppStore.persist.rehydrate();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* radar still works, just without the persistent tile cache */
      });
    }
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 3_600_000,
        buster: "v1",
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === "success" && PERSISTED.has(String(q.queryKey[0])),
        },
      }}
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </PersistQueryClientProvider>
  );
}
