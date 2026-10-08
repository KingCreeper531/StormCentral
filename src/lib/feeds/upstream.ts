import { HttpError, withTimeout } from "../api/http";

/**
 * Upstream access for the weather feeds. The default transport is `fetch`
 * (the Next.js server). The Android build swaps in native HTTP, because
 * several government APIs don't send CORS headers.
 */
export const USER_AGENT = process.env.NWS_USER_AGENT ?? "StormCentral/0.1 (github.com/KingCreeper531/StormCentral)";

export interface UpstreamRequest {
  headers: Record<string, string>;
  timeoutMs: number;
}

/** Resolves with the parsed JSON body; rejects with `HttpError` on a non-2xx status. */
export type UpstreamTransport = (url: string, req: UpstreamRequest) => Promise<unknown>;

const fetchTransport: UpstreamTransport = async (url, { headers, timeoutMs }) => {
  const res = await fetch(url, {
    cache: "no-store", // feeds manage caching themselves (see cache.ts)
    headers,
    signal: withTimeout(undefined, timeoutMs),
  });
  if (!res.ok) throw new HttpError(`Upstream ${res.status} for ${new URL(url).host}`, res.status, url);
  return res.json();
};

let transport: UpstreamTransport = fetchTransport;

export function setUpstreamTransport(next: UpstreamTransport) {
  transport = next;
}

export function upstreamJson<T>(url: string, { headers, timeoutMs = 12_000 }: { headers?: Record<string, string>; timeoutMs?: number } = {}) {
  return transport(url, {
    // Browsers won't let scripts set User-Agent (and it would force a CORS preflight).
    headers: { ...(typeof window === "undefined" && { "User-Agent": USER_AGENT }), Accept: "application/json", ...headers },
    timeoutMs,
  }) as Promise<T>;
}

export function parseLatLon(sp: URLSearchParams): { lat: number; lon: number } | null {
  const rawLat = sp.get("lat")?.trim();
  const rawLon = sp.get("lon")?.trim();
  // Number(null) and Number("") are 0: a missing coordinate must not mean 0°.
  if (!rawLat || !rawLon) return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export const badParams = (message: string) => new HttpError(message, 400);
