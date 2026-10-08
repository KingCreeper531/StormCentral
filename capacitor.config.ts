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
 * StormCentral for Android.
 *
 * By default the app bundles the static export (`out/`, built by
 * `node scripts/build-native.mjs android`) and runs the weather feeds on the
 * phone. Accounts and reports need a server, so the spotter network is off.
 * Set STORMCENTRAL_URL when building to load a hosted StormCentral instead,
 * with everything enabled and one shared spotter network.
 */
const remoteUrl = process.env.STORMCENTRAL_URL;

const config: CapacitorConfig = {
  appId: "io.github.kingcreeper531.stormcentral",
  appName: "StormCentral",
  webDir: "out",
  backgroundColor: "#000000",
  ...(remoteUrl && { server: { url: remoteUrl } }),
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
