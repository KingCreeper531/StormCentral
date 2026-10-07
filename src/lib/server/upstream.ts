import "server-only";
import { HttpError, withTimeout } from "../api/http";

export const USER_AGENT =
  process.env.NWS_USER_AGENT ?? "StormCentral/0.1 (github.com/KingCreeper531/StormCentral)";

export async function upstreamJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 12_000, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    cache: "no-store", // we manage caching ourselves (see cache.ts)
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    signal: withTimeout(undefined, timeoutMs),
  });
  if (!res.ok) throw new HttpError(`Upstream ${res.status} for ${new URL(url).host}`, res.status, url);
  return (await res.json()) as T;
}

/** Uniform JSON response with CDN-friendly caching. */
export function jsonResponse(data: unknown, maxAgeSec: number, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": `public, max-age=${Math.min(maxAgeSec, 60)}, s-maxage=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 2}`,
      ...init.headers,
    },
  });
}

export function errorResponse(err: unknown, fallbackStatus = 502) {
  const status = err instanceof HttpError && err.status >= 400 && err.status < 500 ? err.status : fallbackStatus;
  const message = err instanceof Error ? err.message : "Upstream request failed";
  if (status >= 500) console.error("[api]", message);
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export function parseLatLon(sp: URLSearchParams): { lat: number; lon: number } | null {
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
