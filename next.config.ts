import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

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
  "https://*.cartocdn.com",
  "https://api.maptiler.com",
  "https://api.bigdatacloud.net",
];

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; dev mode additionally needs eval for HMR.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://mesonet.agron.iastate.edu https://*.cartocdn.com https://api.maptiler.com",
  "font-src 'self' data:",
  `connect-src ${CONNECT.join(" ")}${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // satellite.js v7 ships an optional WASM/pthreads runtime; load it from
  // node_modules at runtime instead of bundling it (server-only usage).
  serverExternalPackages: ["satellite.js"],
  async headers() {
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
  },
};

export default nextConfig;
