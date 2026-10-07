/**
 * CSRF defence for cookie-authenticated mutations: browsers always send
 * `Origin` on cross-site POST/DELETE, so requiring it to match our host
 * blocks forged requests even before SameSite=Lax does.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const forbidden = (message = "Forbidden") =>
  Response.json({ error: message }, { status: 403, headers: { "Cache-Control": "no-store" } });

export const unauthorized = () =>
  Response.json({ error: "Sign in required" }, { status: 401, headers: { "Cache-Control": "no-store" } });

export const tooMany = (retryAfterSec: number) =>
  Response.json(
    { error: "Too many requests — slow down." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec), "Cache-Control": "no-store" } },
  );
