"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. Server snapshot is `false`, so pass the
 * *larger* breakpoint (e.g. "(min-width: 768px)") and treat false as mobile.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** md breakpoint (768 px): true on tablets/desktop, false on phones. */
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");
