"use client";

import { useT } from "@/lib/i18n/use-t";
import type { Vars } from "@/lib/i18n/core";

/**
 * Translated text for server components, which can't call `useT()`:
 * `<T>Settings</T>`, `<T vars={{ n }}>{"{n} reports"}</T>`. Renders the
 * English on the server and switches after hydration, like `useT()`.
 */
export function T({ children, vars }: { children: string; vars?: Vars }) {
  const t = useT();
  return t(children, vars);
}
