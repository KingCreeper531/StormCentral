export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Whether a failed request is worth trying again: a dropped connection, a
 * timeout, a rate limit or a busy server (Open-Meteo answers "overloaded" with
 * a 429 or 503). Other client errors (bad parameters, 404) won't fix themselves.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof HttpError)) return true;
  return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
}

/** A request that ran out its time (or was cancelled), as opposed to one that failed fast. */
export const isTimeout = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

/**
 * Runs `run`, and once more after `delayMs` if it failed fast for a reason
 * that may pass (a dropped connection, a 5xx or 429). A timeout isn't tried
 * again: the caller already waited its whole budget, and clients retry later.
 */
export async function retryOnce<T>(run: () => Promise<T>, delayMs = 750): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isTimeout(err) || !isTransient(err)) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    return run();
  }
}

/** Wait before retry `n` (0-based): 1, 2, 4, 8 … seconds up to 30, with jitter so many tabs don't retry in step. */
export const retryDelay = (n: number) => Math.min(30_000, 1_000 * 2 ** n) * (0.75 + Math.random() * 0.5);

export interface GetJsonOptions extends RequestInit {
  timeoutMs?: number;
}

/** Combine a caller's abort signal with a timeout (falls back gracefully on older engines). */
export function withTimeout(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

/** fetch → JSON with timeout, abort propagation and typed errors. */
export async function getJson<T>(url: string, { timeoutMs = 15_000, signal, ...init }: GetJsonOptions = {}): Promise<T> {
  // The Android app is a static bundle with no server: its /api routes run in-process.
  // (Inline env check so web builds drop this branch and the lazy chunk entirely.)
  if (process.env.NEXT_PUBLIC_BUILD_TARGET === "mobile" && url.startsWith("/api/")) {
    const { localApi } = await import("../native/local-api");
    return localApi<T>(url, withTimeout(signal, timeoutMs));
  }
  const res = await fetch(url, { ...init, signal: withTimeout(signal, timeoutMs) });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { reason?: string; error?: string; detail?: string };
      detail = body.reason ?? body.error ?? body.detail ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new HttpError(detail || `${res.status} ${res.statusText}`, res.status, url);
  }
  return (await res.json()) as T;
}

/**
 * Query string from a flat record (arrays become comma lists). Built by hand
 * rather than with URLSearchParams, which the Android background runner's
 * JavaScript engine doesn't provide.
 */
export function qs(params: Record<string, string | number | boolean | undefined | null | readonly (string | number)[]>) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(",") : String(v))}`);
  }
  return parts.join("&");
}
