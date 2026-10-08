import "server-only";
import { HttpError } from "../api/http";

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
