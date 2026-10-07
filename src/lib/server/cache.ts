import "server-only";
import { LruCache } from "../lru";

/**
 * Process-local response cache with request coalescing. During a severe-weather
 * outbreak thousands of clients poll the same alert feed; coalescing collapses
 * concurrent misses into ONE upstream request, and the stale entry keeps being
 * served if the upstream briefly fails (stale-if-error).
 */
interface Entry<T> {
  value: T;
  expires: number;
}

const store = new LruCache<Entry<unknown>>({ maxEntries: 500 });
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = load()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      if (hit) return hit.value; // stale-if-error
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
