/**
 * Small, allocation-light LRU cache with optional TTL and byte budget.
 * Map preserves insertion order, so re-inserting on access gives us recency
 * ordering for free and eviction is O(1) from the iterator head.
 */
export interface LruOptions<V> {
  maxEntries: number;
  /** Optional byte budget; requires `sizeOf`. */
  maxBytes?: number;
  sizeOf?: (value: V) => number;
  /** Entries older than this are treated as missing. */
  ttlMs?: number;
  onEvict?: (key: string, value: V) => void;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  bytes: number;
  storedAt: number;
}

export class LruCache<V> {
  private readonly map = new Map<string, Entry<V>>();
  private bytes = 0;
  private readonly now: () => number;

  constructor(private readonly opts: LruOptions<V>) {
    if (opts.maxEntries < 1) throw new Error("maxEntries must be >= 1");
    this.now = opts.now ?? Date.now;
  }

  get size() {
    return this.map.size;
  }

  get totalBytes() {
    return this.bytes;
  }

  has(key: string): boolean {
    return this.peek(key) !== undefined;
  }

  /** Read without touching recency. */
  peek(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.expired(e)) {
      this.delete(key);
      return undefined;
    }
    return e.value;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.expired(e)) {
      this.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V): this {
    const existing = this.map.get(key);
    if (existing) {
      this.map.delete(key);
      this.bytes -= existing.bytes;
      if (existing.value !== value) this.opts.onEvict?.(key, existing.value);
    }
    const bytes = this.opts.sizeOf?.(value) ?? 0;
    this.map.set(key, { value, bytes, storedAt: this.now() });
    this.bytes += bytes;
    this.trim();
    return this;
  }

  delete(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.map.delete(key);
    this.bytes -= e.bytes;
    this.opts.onEvict?.(key, e.value);
    return true;
  }

  clear() {
    for (const key of [...this.map.keys()]) this.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  private expired(e: Entry<V>) {
    return this.opts.ttlMs !== undefined && this.now() - e.storedAt > this.opts.ttlMs;
  }

  private trim() {
    const { maxEntries, maxBytes } = this.opts;
    while (this.map.size > maxEntries || (maxBytes !== undefined && this.bytes > maxBytes && this.map.size > 1)) {
      const oldest = this.map.keys().next().value as string;
      this.delete(oldest);
    }
  }
}
