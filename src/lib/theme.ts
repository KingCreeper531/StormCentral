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
export function applyTheme(theme: Theme, chrome: string = THEME_COLOR[theme]) {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", chrome));
}

const customProps = new Set<string>();

/**
 * Inline token overrides from a custom theme (see lib/addons). Inline styles on
 * <html> beat the `:root[data-theme]` blocks, so `null` falls back cleanly.
 */
export function applyCustomVars(vars: Record<string, string> | null) {
  const style = document.documentElement.style;
  // Also clear what the boot script set before React took over.
  for (const name of [...customProps, ...Array.from(style).filter((n) => n.startsWith("--color-") || n === "--overlay-bg")]) style.removeProperty(name);
  customProps.clear();
  for (const [name, value] of Object.entries(vars ?? {})) {
    style.setProperty(name, value);
    customProps.add(name);
  }
}

/**
 * Runs in <head> before the page paints, so a light-mode user never sees a
 * dark flash. Reads the persisted app store directly (key `stormcentral:v1`)
 * and any custom theme from the add-ons store (`stormcentral:addons:v1`);
 * only hex colours are applied, matching lib/addons/manifest.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=(JSON.parse(localStorage.getItem("stormcentral:v1")||"{}").state||{}).theme;var t=p==="light"||p==="dark"?p:(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var r=document.documentElement;var a=(JSON.parse(localStorage.getItem("stormcentral:addons:v1")||"{}").state)||{};var c=null;(a.themes||[]).forEach(function(x){if(x&&x.id===a.activeTheme)c=x});if(c&&c.colors){t=c.base==="light"?"light":"dark";var h=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;for(var k in c.colors){if(/^[a-z0-9-]+$/.test(k)&&h.test(c.colors[k]))r.style.setProperty("--color-"+k,c.colors[k])}if(h.test(c.colors["surface-1"]))r.style.setProperty("--overlay-bg","color-mix(in srgb, "+c.colors["surface-1"]+" 93%, transparent)");if(c.sky==="vivid")r.dataset.sky="vivid"}r.dataset.theme=t;r.style.colorScheme=t;}catch(e){}})();`;
