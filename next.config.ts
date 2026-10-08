import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * One codebase, three packages (see scripts/build-native.mjs):
 *  - web:     `next build` for a Node host or Vercel.
 *  - desktop: a self-contained `standalone` server that the Windows app runs locally.
 *  - mobile:  a static export bundled into the Android app. Route handlers and
 *             pages that need the server (`*.server.tsx`) are left out, and the
 *             weather feeds run on the device instead (lib/native/local-api).
 */
type BuildTarget = "web" | "desktop" | "mobile";
const target = (process.env.BUILD_TARGET ?? "web") as BuildTarget;
if (!["web", "desktop", "mobile"].includes(target)) throw new Error(`Unknown BUILD_TARGET "${target}"`);
const isStaticExport = target === "mobile";

/**
 * Every upstream the browser talks to directly. Anything not listed here is
 * proxied (and cached) through our own /api routes.
 */
const CONNECT = [
  "'self'",
  "https://api.open-meteo.com",
  "https://air-quality-api.open-meteo.com",
  "https://geocoding-api.open-meteo.com",
  "https://mesonet.agron.iastate.edu",
  // GOES satellite imagery (NASA GIBS).
  "https://gibs.earthdata.nasa.gov",
  "https://*.cartocdn.com",
  "https://api.maptiler.com",
  "https://api.bigdatacloud.net",
  // Android app: in-app update check against GitHub Releases.
  "https://api.github.com",
];

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; dev mode additionally needs eval for HMR.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://mesonet.agron.iastate.edu https://gibs.earthdata.nasa.gov https://nowcoast.noaa.gov https://*.cartocdn.com https://api.maptiler.com",
  // Radar loop exports preview as blob: video.
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src ${CONNECT.join(" ")}${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

async function headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
      ],
    },
    {
      source: "/icons/weather/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
    },
    {
      source: "/vendor/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
    },
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    // Always defined, so client code can branch on it and dead branches are dropped.
    NEXT_PUBLIC_BUILD_TARGET: isStaticExport ? "mobile" : "web",
    NEXT_PUBLIC_GITHUB_REPO: process.env.GITHUB_REPOSITORY ?? "",
  },
  ...(target === "desktop" && {
    output: "standalone",
    // No next/image in the app, so the desktop bundle doesn't need sharp's ~45 MB of libvips.
    outputFileTracingExcludes: { "*": ["node_modules/sharp/**", "node_modules/@img/**"] },
  }),
  ...(isStaticExport
    ? {
        output: "export",
        // Directory-style output (`community/index.html`), which plain file servers resolve without rewrites.
        trailingSlash: true,
        // Only .tsx: drops every route.ts handler, manifest.ts and *.server.tsx page.
        pageExtensions: ["tsx"],
        images: { unoptimized: true },
      }
    : { pageExtensions: ["server.tsx", "tsx", "ts"] }),
  // Static exports can't set response headers.
  ...(!isStaticExport && { headers }),
};

export default nextConfig;
