import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { IS_STATIC_BUNDLE } from "@/lib/platform";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StormCentral — Open-data weather, radar & spotter network",
    template: "%s · StormCentral",
  },
  description:
    "Immersive forecasts, live NEXRAD radar, severe-weather warnings, drone & angler modes, air quality, and a community spotter network — built entirely on open data.",
  applicationName: "StormCentral",
  // The Android app bundle has no manifest route (and doesn't need one).
  manifest: IS_STATIC_BUNDLE ? undefined : "/manifest.webmanifest",
};

export const viewport: Viewport = {
  // Updated to the active theme on the client (lib/theme.ts).
  themeColor: "#000000",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The boot script sets data-theme before hydration, so the attribute differs from the server markup.
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved light/dark choice before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
