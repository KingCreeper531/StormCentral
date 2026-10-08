"use client";

import { useSyncExternalStore } from "react";
import type { Theme } from "@/lib/theme";

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
const snapshot = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** The theme on screen (dark on the server and during hydration). */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribe, snapshot, () => "dark");
}
