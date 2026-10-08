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

/** `owner/name` of the GitHub repository that publishes releases (set per fork by CI). */
export const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || "KingCreeper531/StormCentral";

/** True inside the Android app, in both the bundled and the hosted configuration. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}
