/// <reference types="@capacitor/background-runner" />
/// <reference types="@capacitor/local-notifications" />
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The background runner's label also names the Android SharedPreferences
 * file its key-value store writes, which the home-screen widget reads
 * (WeatherWidgetProvider.java). Keep them in sync.
 */
export const RUNNER_LABEL = "io.github.kingcreeper531.stormcentral.alerts";

/**
 * Storm Central for Android.
 *
 * By default the app bundles the static export (`out/`, built by
 * `node scripts/build-native.mjs android`) and runs the weather feeds on the
 * phone. Accounts and reports need a server, so the spotter network is off.
 * Set STORMCENTRAL_URL when building to load a hosted Storm Central instead,
 * with everything enabled and one shared spotter network. When it doesn't
 * load (no signal, or a VPN or private DNS that can't find it), the app shows
 * its own offline.html, which retries and offers the backup server
 * (STORMCENTRAL_BACKUP_URL, Vercel by default; "none" to leave it out).
 */
const remoteUrl = process.env.STORMCENTRAL_URL;
const backupUrl = process.env.STORMCENTRAL_BACKUP_URL ?? "https://storm-central-pi.vercel.app";
const backupHost = backupUrl === "none" ? null : new URL(backupUrl).host;

const config: CapacitorConfig = {
  appId: "io.github.kingcreeper531.stormcentral",
  appName: "Storm Central",
  webDir: "out",
  backgroundColor: "#000000",
  ...(remoteUrl && {
    server: {
      url: remoteUrl,
      errorPath: "offline.html",
      // The backup opens in the app rather than the browser.
      ...(backupHost && { allowNavigation: [backupHost] }),
    },
  }),
  plugins: {
    SystemBars: {
      // Edge-to-edge, with real env(safe-area-inset-*) values: the layout pads
      // the top bar and tab bar itself (viewport-fit=cover).
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
      // Light icons on the app's black background.
      style: "DARK",
    },
    // Warnings and custom alerts while the app is closed: a headless JS runner
    // that Android wakes about every 15 minutes (src/native/runner, bundled to
    // out/runners/background.js by scripts/build-native.mjs).
    BackgroundRunner: {
      label: RUNNER_LABEL,
      src: "runners/background.js",
      event: "check",
      repeat: true,
      interval: 15,
      autoStart: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_stormcentral",
      iconColor: "#5b9cf6",
    },
  },
};

export default config;
