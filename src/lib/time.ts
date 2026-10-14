import { translator, type Translator } from "./i18n/core";

const EN = translator("en");

/** Relative-time formatters by locale (`""` = the device's). */
const rtfs = new Map<string, Intl.RelativeTimeFormat>();
function rtfFor(locale: string | undefined): Intl.RelativeTimeFormat | null {
  if (typeof Intl === "undefined" || !Intl.RelativeTimeFormat) return null;
  const key = locale ?? "";
  let f = rtfs.get(key);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    rtfs.set(key, f);
  }
  return f;
}

/**
 * "just now", "5 min ago", "3 days ago", or a short date beyond a week. Pass
 * the page's translator (`useT()`) for the person's language; without one it
 * reads in English with the device's number and date conventions.
 */
export function timeAgo(ms: number, now = Date.now(), t?: Translator): string {
  const locale = t?.locale;
  const s = Math.round((ms - now) / 1000);
  const abs = Math.abs(s);
  const rtf = rtfFor(locale);
  if (!rtf) return new Date(ms).toLocaleString(locale);
  if (abs < 45) return (t ?? EN)("just now");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(s / 86_400), "day");
  return new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" });
}
