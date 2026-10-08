/**
 * A weather feed: the logic behind one `/api/*` GET route. Feeds are
 * isomorphic. The Next.js route handlers serve them over HTTP, and the
 * Android build (a static bundle with no server) runs them on the device.
 */
export interface Feed<T = unknown> {
  /** The route that serves this feed, e.g. `/api/alerts`. */
  path: `/api/${string}`;
  /** Reject bad parameters with `HttpError(…, 400)`; upstream failures propagate. */
  load: (params: URLSearchParams) => Promise<T>;
  /** CDN cache lifetime (s) for the HTTP response. */
  maxAge: number | ((params: URLSearchParams) => number);
}
