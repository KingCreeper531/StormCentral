// @ts-check
/**
 * Packages the desktop apps: the Electron shell (desktop/) plus, where it's
 * used, the standalone Next.js server staged in build/desktop/server/ by
 * scripts/build-native.mjs.
 *
 *   npm run desktop:dist      → dist/desktop/StormCentral-Setup-<version>.exe (Windows)
 *   npm run desktop:dist:mac  → dist/desktop/StormCentral-<version>.dmg (macOS, on a Mac)
 *
 * Releases are published by .github/workflows/release.yml. The installer and
 * latest.yml go on a GitHub release, which is where installed Windows apps
 * look for updates (electron-updater, GitHub provider).
 *
 * The Mac app is one universal (Apple silicon + Intel) .dmg, built without an
 * Apple Developer ID: it's ad-hoc signed (an unsigned arm64 app won't open at
 * all) and not notarized, so the first launch needs System Settings → Privacy
 * & Security → Open Anyway. Squirrel.Mac only installs updates signed with a
 * Developer ID, so there's no latest-mac.yml: the app checks the latest
 * release itself and offers the download (desktop/release-check.mjs). It
 * only supports hosted builds (STORMCENTRAL_URL): the embedded server's
 * native libSQL module is built for one architecture, which a universal app
 * can't carry, so a local Mac build without STORMCENTRAL_URL is for this
 * Mac's architecture only.
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
/** Build-time switch: point the app at a hosted Storm Central instead of the local server. */
const remoteUrl = process.env.STORMCENTRAL_URL || null;

/**
 * Microsoft Store package (MSIX/AppX). The identity comes from Partner Center
 * → the app → Product management → Product identity. It isn't secret (every
 * Store package carries it); the MSIX_* environment variables override it,
 * e.g. for a fork with its own Store listing. The Store signs the package
 * itself, so no certificate is needed.
 */
const MSIX = {
  identityName: process.env.MSIX_IDENTITY_NAME || "StormCentral.8571E95C8232",
  publisher: process.env.MSIX_PUBLISHER || "CN=52BC6B8C-96DD-4277-9BD0-4F00E72C021D",
  publisherDisplayName: process.env.MSIX_PUBLISHER_DISPLAY_NAME || "StormCentral",
  // Must match the name reserved in Partner Center.
  displayName: process.env.MSIX_DISPLAY_NAME || "Storm Central",
};
// SKIP_MSIX=1 leaves it out (a release that shouldn't go to the Store).
const buildMsix = process.env.SKIP_MSIX !== "1" && !!(MSIX.identityName && MSIX.publisher && MSIX.publisherDisplayName);
const repo = process.env.GITHUB_REPOSITORY || "KingCreeper531/StormCentral";
const [owner, name] = repo.split("/");

/**
 * The local server. It needs real files on disk (native libSQL module), so it
 * lives outside the asar. Copied via its parent folder: electron-builder
 * always drops the *top-level* node_modules of an extraResources source,
 * which would gut the server. Listed per platform because platform
 * extraResources add to the top-level list rather than replace it, and the
 * hosted Mac app leaves it out.
 * @type {import("electron-builder").FileSet[]}
 */
const serverResources = [{ from: "build/desktop", to: ".", filter: ["server/**/*"] }];

/** @type {import("electron-builder").Configuration} */
const config = {
  appId: "io.github.kingcreeper531.stormcentral",
  // stormcentral:// links (the website's "Open in app" button) launch or focus the app.
  protocols: [{ name: "Storm Central", schemes: ["stormcentral"] }],
  productName: "StormCentral",
  copyright: "© 2026 KingCreeper531 · MIT License",
  directories: { app: "desktop", output: "dist/desktop", buildResources: "desktop/resources" },
  // One version for the web app and the desktop shell: the root package.json.
  extraMetadata: {
    version: pkg.version,
    stormcentral: { remoteUrl, repo },
  },
  files: ["**/*", "!resources{,/**}", "!**/*.test.mjs"],
  asar: true,
  // electron-updater is plain JS; nothing to rebuild for Electron's ABI.
  npmRebuild: false,
  electronLanguages: ["en-US"],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }, ...(buildMsix ? [{ target: "appx", arch: ["x64"] }] : [])],
    icon: "icon.png",
    extraResources: serverResources,
    // Optional signing: set CSC_LINK / CSC_KEY_PASSWORD secrets and electron-builder signs automatically.
  },
  nsis: {
    // Per-user, no admin prompt: installs and silent updates never need UAC.
    oneClick: true,
    perMachine: false,
    artifactName: "StormCentral-Setup-${version}.${ext}",
    shortcutName: "Storm Central",
    uninstallDisplayName: "Storm Central",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    // Keep accounts, reports and settings if the app is uninstalled and reinstalled.
    deleteAppDataOnUninstall: false,
  },
  // The Store package: same app; updates come from the Store (desktop/updater.mjs checks process.windowsStore).
  // Tile and logo images are in desktop/resources/appx/.
  appx: {
    applicationId: "StormCentral",
    displayName: MSIX.displayName,
    identityName: MSIX.identityName,
    publisher: MSIX.publisher,
    publisherDisplayName: MSIX.publisherDisplayName,
    backgroundColor: "#0b1a33",
    // Spanish too, so the Store listing can have a Spanish page (the app follows the device language).
    languages: ["en-US", "es-US", "es-MX"],
    showNameOnTiles: false,
    // Location for "Use my location"; network access is part of a full-trust desktop app.
    capabilities: ["internetClient", "location"],
    artifactName: "StormCentral-${version}-store.${ext}",
  },
  // Lets contributors on Linux run the packaged app locally (`npm run desktop:dist -- --linux dir`).
  linux: { target: ["AppImage"], category: "Science", icon: "icon.png", extraResources: serverResources },
  // macOS 13 or newer (Electron's minimum). See the header for why it's ad-hoc signed and hosted.
  mac: {
    // One .dmg for Apple silicon and Intel. A local-server build is for this Mac's architecture
    // only, because the server's native module is.
    target: [{ target: "dmg", arch: remoteUrl ? ["universal"] : [process.arch === "arm64" ? "arm64" : "x64"] }],
    category: "public.app-category.weather",
    // electron-builder turns the 1024 px PNG into the .icns.
    icon: "icon.png",
    // "-" signs ad hoc: no certificate, but Apple silicon runs it (an unsigned arm64 app shows
    // as "damaged"). Never left unset: unset, electron-builder looks for a certificate in the
    // keychain and skips signing entirely when there's none. CI has no certificate (no CSC_LINK,
    // CSC_IDENTITY_AUTO_DISCOVERY=false).
    identity: "-",
    // Hardened runtime only matters for notarization, and its library validation would reject
    // Electron's frameworks under an ad-hoc signature.
    hardenedRuntime: false,
    notarize: false,
    // Passed to codesign as --timestamp=none: an ad-hoc signature has nothing for Apple's timestamp server to vouch for.
    timestamp: "none",
    // Native dialogs and menus follow the system's light or dark appearance.
    darkModeSupport: true,
    extraResources: remoteUrl ? [] : serverResources,
    // macOS takes the app's language from its .lproj folders and the page follows it, so keep Spanish.
    electronLanguages: ["en", "es", "es_419"],
    // "Use my location": macOS shows this when it asks for permission.
    extendInfo: {
      NSLocationUsageDescription: "Storm Central uses your location to show the weather and warnings where you are.",
      NSLocationWhenInUseUsageDescription: "Storm Central uses your location to show the weather and warnings where you are.",
    },
    // No electron-updater feed (latest-mac.yml) or app-update.yml for the Mac app.
    publish: null,
  },
  dmg: {
    artifactName: "StormCentral-${version}.${ext}",
    title: "Storm Central ${version}",
    // No .blockmap: it's only for electron-updater's differential downloads.
    writeUpdateInfo: false,
  },
  publish: [{ provider: "github", owner, repo: name, releaseType: "release" }],
};

export default config;
