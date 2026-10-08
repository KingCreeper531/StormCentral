import { HttpError } from "../api/http";
import { FEEDS } from "../feeds";
import { setUpstreamTransport } from "../feeds/upstream";
import { hasNativeHttp, nativeTransport } from "./upstream-transport";

/**
 * The `/api/*` weather routes, served in-process for the static Android
 * bundle. The same feed code runs here as on the server, so responses are
 * identical. Outside the native app (e.g. previewing the export in a desktop
 * browser) it falls back to `fetch`, where CORS-less feeds may fail.
 */
if (hasNativeHttp()) setUpstreamTransport(nativeTransport);

export async function localApi<T>(url: string, signal?: AbortSignal): Promise<T> {
  const { pathname, searchParams } = new URL(url, "https://localhost");
  const feed = FEEDS.get(pathname.replace(/\/$/, ""));
  if (!feed) throw new HttpError("The spotter network isn't available in this version of the app", 503, url);
  signal?.throwIfAborted();
  // Feeds are cached and coalesced across callers, so an abort only stops this caller waiting.
  if (!signal) return feed.load(searchParams) as Promise<T>;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    (feed.load(searchParams) as Promise<T>).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
