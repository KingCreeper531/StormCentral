import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { IS_STATIC_BUNDLE, PUBLIC_APP_URL } from "@/lib/platform";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

const TITLE = "Storm Central — Open-data weather, radar & spotter network";
const DESCRIPTION =
  "Immersive forecasts, live NEXRAD radar, severe-weather warnings, drone & angler modes, air quality, and a community spotter network — built entirely on open data.";
/** The landing site's 1200×630 share card. */
const SHARE_IMAGE = { url: "https://www.stormcentralwx.com/assets/og.png", width: 1200, height: 630, alt: "Storm Central" };

export const metadata: Metadata = {
  // Canonical and Open Graph URLs resolve against the hosted app, whichever copy (desktop, a preview) serves the page.
  metadataBase: new URL(PUBLIC_APP_URL),
  title: {
    default: TITLE,
    template: "%s · Storm Central",
  },
  description: DESCRIPTION,
  applicationName: "Storm Central",
  // Each page sets its own canonical (alternates.canonical): a canonical here would point every page at the home page.
  openGraph: { type: "website", siteName: "Storm Central", title: TITLE, description: DESCRIPTION, images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [SHARE_IMAGE.url] },
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
