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

export function qs(params: Record<string, string | number | boolean | undefined | null | readonly (string | number)[]>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return sp.toString();
}
