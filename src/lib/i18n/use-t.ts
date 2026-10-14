"use client";

import { useSyncExternalStore } from "react";
import { useAppStore } from "@/store/app-store";
import { resolveLang } from "./lang";
import { translator, type Lang, type Translator } from "./core";

const deviceLangs = () => (typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

/** The language shown now (the setting, or the device's for "auto"). Outside React too. */
export const currentLang = (): Lang => resolveLang(useAppStore.getState().language, deviceLangs());

/**
 * The language to render in. Server rendering and hydration use English, then
 * the client switches, so the markup always matches what the server sent.
 */
export function useLang(): Lang {
  return useSyncExternalStore(useAppStore.subscribe, currentLang, () => "en");
}

/** `const t = useT(); t("Settings")`, `t.plural(n, "{n} report", "{n} reports")`, `t.locale` for Intl. */
export function useT(): Translator {
  return translator(useLang());
}
