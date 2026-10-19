import "server-only";
import { createHash } from "node:crypto";
import { HttpError } from "../api/http";

const cacheControl = (maxAgeSec: number) => `public, max-age=${Math.min(maxAgeSec, 60)}, s-maxage=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 2}`;

/** Uniform JSON response with CDN-friendly caching. */
export function jsonResponse(data: unknown, maxAgeSec: number, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": cacheControl(maxAgeSec), ...init.headers },
  });
}

/**
 * A feed's JSON with CDN caching and an ETag: when a poll finds the data
 * unchanged, the browser gets an empty 304 instead of the whole payload
 * again (the hazard map alone is hundreds of kilobytes every 2 minutes).
 */
export function cachedJsonResponse(req: Request, data: unknown, maxAgeSec: number) {
  const body = JSON.stringify(data);
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { "Cache-Control": cacheControl(maxAgeSec), ETag: etag };
  const match = req.headers.get("if-none-match");
  if (match && match.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
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
