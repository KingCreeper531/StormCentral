/**
 * Where this bundle runs. The same UI ships three ways:
 *  - Web: served by the Next.js server, either a hosted deployment or the
 *    server embedded in the Windows desktop app.
 *  - Android: a static export inside the Capacitor app. There is no server,
 *    so the weather feeds run on the phone (lib/native/local-api). The
 *    spotter network needs the shared database and is unavailable.
 *
 * `NEXT_PUBLIC_BUILD_TARGET` is always defined by next.config.ts, so the
 * bundler folds these checks to constants and drops dead branches.
 */
export const IS_STATIC_BUNDLE = process.env.NEXT_PUBLIC_BUILD_TARGET === "mobile";

/** Accounts and reports need the server and its database. */
export const COMMUNITY_ENABLED = !IS_STATIC_BUNDLE;

/** The hosted web app, for links people share (the apps' own addresses aren't reachable from elsewhere). */
export const PUBLIC_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.stormcentralwx.com").replace(/\/+$/, "");

/** `owner/name` of the GitHub repository that publishes releases (set per fork by CI). */
export const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || "KingCreeper531/StormCentral";

/** Added to the Android app's user agent (capacitor.config.ts appendUserAgent). */
export const APP_USER_AGENT = "StormCentralApp";

/**
 * True inside the Android app's web view even where Capacitor's bridge isn't
 * (the backup server it falls back to), so the app's native features aren't
 * there; isNativeApp() says whether they are.
 */
export function inAppWebView(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes(APP_USER_AGENT);
}

/** True inside the Android app, in both the bundled and the hosted configuration. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}
