import "server-only";
import type { Feed } from "../feeds/types";
import { cachedJsonResponse, errorResponse } from "./respond";

/** A GET route handler that serves a feed with CDN caching and uniform errors. */
export function feedRoute<T>(feed: Feed<T>) {
  return async function GET(req: Request) {
    const params = new URL(req.url).searchParams;
    try {
      const data = await feed.load(params);
      return cachedJsonResponse(req, data, typeof feed.maxAge === "function" ? feed.maxAge(params) : feed.maxAge);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
