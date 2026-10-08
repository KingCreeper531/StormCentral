import { LruCache } from "../lru";

/**
 * Feed cache with request coalescing. On the server it is process-wide:
 * during a severe-weather outbreak thousands of clients poll the same alert
 * feed, and coalescing collapses concurrent misses into ONE upstream request.
 * The stale entry keeps being served if the upstream briefly fails
 * (stale-if-error). On a phone it is per app session, and `persist` entries
 * also survive restarts.
 */
interface Entry<T> {
  value: T;
  expires: number;
}

export interface CacheOptions {
  /** Browser only: also keep the entry in localStorage, so it survives restarts. */
  persist?: boolean;
}

const store = new LruCache<Entry<unknown>>({ maxEntries: 500 });
const inflight = new Map<string, Promise<unknown>>();
const PERSIST_PREFIX = "stormcentral:feed:";

function readPersisted<T>(key: string): Entry<T> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(PERSIST_PREFIX + key);
    return raw ? (JSON.parse(raw) as Entry<T>) : undefined;
  } catch {
    return undefined;
  }
}

function writePersisted(key: string, entry: Entry<unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota or privacy mode: the in-memory entry still works */
  }
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, opts: CacheOptions = {}): Promise<T> {
  let hit = store.get(key) as Entry<T> | undefined;
  if (!hit && opts.persist) {
    hit = readPersisted<T>(key);
    if (hit) store.set(key, hit);
  }
  if (hit && hit.expires > Date.now()) return hit.value;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = load()
    .then((value) => {
      const entry = { value, expires: Date.now() + ttlMs };
      store.set(key, entry);
      if (opts.persist) writePersisted(key, entry);
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
