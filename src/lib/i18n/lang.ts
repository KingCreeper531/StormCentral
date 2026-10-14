/** Language ids and choosing one (no dictionaries here, so it is cheap to import anywhere). */

export type Lang = "en" | "es";
/** "auto" follows the device's language. */
export type LangPref = "auto" | Lang;

export const LANGS: readonly { id: LangPref; label: string }[] = [
  { id: "auto", label: "Automatic" },
  { id: "en", label: "English" },
  // Shown in its own language, so a Spanish speaker can find it in English.
  { id: "es", label: "Español" },
];

export const isLangPref = (v: unknown): v is LangPref => v === "auto" || v === "en" || v === "es";

/** The language to show: the choice, or for "auto" the first device language we have. */
export function resolveLang(pref: LangPref, deviceLangs: readonly string[] = []): Lang {
  if (pref !== "auto") return pref;
  for (const l of deviceLangs) {
    const base = l.toLowerCase().split(/[-_]/)[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return "en";
}

/** BCP 47 locale for Intl dates and numbers (US conventions in both languages). */
export const localeFor = (lang: Lang) => (lang === "es" ? "es-US" : "en-US");
