import type { CapacitorConfig } from "@capacitor/cli";

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
  },
};

export default config;
