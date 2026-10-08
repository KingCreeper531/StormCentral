/** What the user picked in Settings. */
export type ThemePref = "system" | "light" | "dark";
/** What's on screen. */
export type Theme = "light" | "dark";

/** Browser chrome colour (status bar, title bar) per theme; matches `--color-canvas`. */
export const THEME_COLOR: Record<Theme, string> = { dark: "#000000", light: "#f3f4f6" };

export function resolveTheme(pref: ThemePref | undefined): Theme {
  if (pref === "light" || pref === "dark") return pref;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Put a theme on the document: tokens switch on `data-theme`, form controls on `color-scheme`. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[theme]));
}

/**
 * Runs in <head> before the page paints, so a light-mode user never sees a
 * dark flash. Reads the persisted app store directly (key `stormcentral:v1`).
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=(JSON.parse(localStorage.getItem("stormcentral:v1")||"{}").state||{}).theme;var t=p==="light"||p==="dark"?p:(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;}catch(e){}})();`;
