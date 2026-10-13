// @ts-check
/**
 * Packages the Windows app: the Electron shell (desktop/) plus the standalone
 * Next.js server staged in build/desktop/server/ by scripts/build-native.mjs.
 *
 *   npm run desktop:dist     → dist/desktop/StormCentral-Setup-<version>.exe
 *
 * Releases are published by .github/workflows/release.yml. The installer and
 * latest.yml go on a GitHub release, which is where installed apps look for
 * updates (electron-updater, GitHub provider).
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Microsoft Store package (MSIX/AppX). The identity comes from Partner Center
 * → the app → Product management → Product identity. It isn't secret; set it
 * here or as the MSIX_* repository variables. Until it is set, only the
 * installer is built (a package with the wrong identity can't be uploaded).
 * The Store signs the package itself, so no certificate is needed.
 */
const MSIX = {
  identityName: process.env.MSIX_IDENTITY_NAME || "",
  publisher: process.env.MSIX_PUBLISHER || "",
  publisherDisplayName: process.env.MSIX_PUBLISHER_DISPLAY_NAME || "",
};
const buildMsix = !!(MSIX.identityName && MSIX.publisher && MSIX.publisherDisplayName);
const repo = process.env.GITHUB_REPOSITORY || "KingCreeper531/StormCentral";
const [owner, name] = repo.split("/");

/** @type {import("electron-builder").Configuration} */
const config = {
  appId: "io.github.kingcreeper531.stormcentral",
  // stormcentral:// links (the website's "Open in app" button) launch or focus the app.
  protocols: [{ name: "StormCentral", schemes: ["stormcentral"] }],
  productName: "StormCentral",
  copyright: "© 2026 KingCreeper531 · MIT License",
  directories: { app: "desktop", output: "dist/desktop", buildResources: "desktop/resources" },
  // One version for the web app and the desktop shell: the root package.json.
  extraMetadata: {
    version: pkg.version,
    // Build-time switch: point the app at a hosted StormCentral instead of the local server.
    stormcentral: { remoteUrl: process.env.STORMCENTRAL_URL || null, repo },
  },
  files: ["**/*", "!resources{,/**}"],
  asar: true,
  // The server needs real files on disk (native libSQL module), so it lives outside the asar.
  // Copied via its parent folder: electron-builder always drops the *top-level*
  // node_modules of an extraResources source, which would gut the server.
  extraResources: [{ from: "build/desktop", to: ".", filter: ["server/**/*"] }],
  // electron-updater is plain JS; nothing to rebuild for Electron's ABI.
  npmRebuild: false,
  electronLanguages: ["en-US"],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }, ...(buildMsix ? [{ target: "appx", arch: ["x64"] }] : [])],
    icon: "icon.png",
    // Optional signing: set CSC_LINK / CSC_KEY_PASSWORD secrets and electron-builder signs automatically.
  },
  nsis: {
    // Per-user, no admin prompt: installs and silent updates never need UAC.
    oneClick: true,
    perMachine: false,
    artifactName: "StormCentral-Setup-${version}.${ext}",
    shortcutName: "StormCentral",
    uninstallDisplayName: "StormCentral",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    // Keep accounts, reports and settings if the app is uninstalled and reinstalled.
    deleteAppDataOnUninstall: false,
  },
  // The Store package: same app; updates come from the Store (desktop/updater.mjs checks process.windowsStore).
  // Tile and logo images are in desktop/resources/appx/.
  appx: {
    applicationId: "StormCentral",
    displayName: "StormCentral",
    identityName: MSIX.identityName || "StormCentral",
    publisher: MSIX.publisher || "CN=StormCentral",
    publisherDisplayName: MSIX.publisherDisplayName || "StormCentral",
    backgroundColor: "#0b1a33",
    languages: ["en-US"],
    showNameOnTiles: false,
    // Location for "Use my location"; network access is part of a full-trust desktop app.
    capabilities: ["internetClient", "location"],
    artifactName: "StormCentral-${version}-store.${ext}",
  },
  // Lets contributors on Linux run the packaged app locally (`npm run desktop:dist -- --linux dir`).
  linux: { target: ["AppImage"], category: "Science", icon: "icon.png" },
  publish: [{ provider: "github", owner, repo: name, releaseType: "release" }],
};

export default config;
