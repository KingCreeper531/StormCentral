/**
 * Fetching custom layers in the browser. Straight from the source when it
 * allows cross-origin reads (most feeds do), trying https first for http
 * links; otherwise through /api/gis (lib/server/gis-proxy). The Android app
 * has no server: it uses the platform's HTTP stack, which CORS doesn't
 * apply to.
 */
import { MAX_GIS_BYTES } from "./index";

const DIRECT_TIMEOUT_MS = 8_000;
const PROXY_TIMEOUT_MS = 20_000;
const mobile = process.env.NEXT_PUBLIC_BUILD_TARGET === "mobile";

const timed = (signal: AbortSignal | undefined, ms: number) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

async function get(url: string, signal?: AbortSignal): Promise<Response> {
  const direct = [url.startsWith("http://") ? url.replace(/^http:/, "https:") : url];
  for (const u of direct) {
    try {
      const res = await fetch(u, { signal: timed(signal, DIRECT_TIMEOUT_MS), credentials: "omit" });
      if (res.ok) return res;
    } catch (err) {
      if (signal?.aborted) throw err;
      // Blocked by CORS, no https, or unreachable from here: the proxy tries.
    }
  }
  const res = await fetch(`/api/gis?url=${encodeURIComponent(url)}`, { signal: timed(signal, PROXY_TIMEOUT_MS) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return res;
}

export async function fetchLayerText(url: string, signal?: AbortSignal): Promise<string> {
  if (mobile) {
    const { nativeText } = await import("../native/gis-native");
    return nativeText(url);
  }
  const text = await (await get(url, signal)).text();
  if (text.length > MAX_GIS_BYTES) throw new Error("The layer is too big");
  return text;
}

/** A placefile's icon sheet, decoded. */
export async function fetchIconSheet(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  if (mobile) {
    const { nativeBlob } = await import("../native/gis-native");
    return createImageBitmap(await nativeBlob(url));
  }
  return createImageBitmap(await (await get(url, signal)).blob());
}
