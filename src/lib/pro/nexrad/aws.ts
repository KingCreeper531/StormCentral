/**
 * Finding NEXRAD files on the NOAA Open Data buckets (AWS, public, CORS
 * open): Level III products are flat keys `TLX_N0C_2026_10_19_15_52_10`,
 * Level II volumes `2026/10/19/KTLX/KTLX20261019_155210_V06`.
 */
export const L3_BUCKET = "https://unidata-nexrad-level3.s3.amazonaws.com";
export const L2_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";

export interface RemoteFile {
  key: string;
  url: string;
  /** Volume scan start, epoch ms. */
  time: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (ms: number, sep: string) => {
  const d = new Date(ms);
  return [d.getUTCFullYear(), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())].join(sep);
};

/** Keys from an S3 ListObjectsV2 response. */
export function parseKeys(xml: string): string[] {
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
}

/** `TLX_N0C_2026_10_19_15_52_10` → epoch ms. */
export function l3Time(key: string): number {
  const m = key.match(/_(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)$/);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : NaN;
}

/**
 * `…/KTLX20261019_155210_V06` → epoch ms; also the archive's older names
 * (`KTLX20130520_195111_V06.gz`, `KTLX19950520_000147.gz`). NaN for other
 * files, e.g. _MDM.
 */
export function l2Time(key: string): number {
  const m = key.match(/[A-Z]{4}(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)(?:_V\d\d)?(?:\.gz)?$/);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : NaN;
}

async function list(bucket: string, prefix: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${bucket}/?list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`, { signal });
  if (!res.ok) throw new Error(`S3 listing failed: ${res.status}`);
  return parseKeys(await res.text());
}

/** Days (UTC) covering `since`…now, newest last. */
const days = (since: number, now: number) => (ymd(since, "") === ymd(now, "") ? [now] : [since, now]);

/** Within `since`…`until` (no upper bound when live: the device's clock may run behind the radar's). */
const within = (since: number, until: number | undefined) => (f: RemoteFile) => f.time >= since && (until == null || f.time <= until);

/** Level III files for a 3-letter site and product code since `since` (up to `until`, looking back), oldest first. */
export async function listLevel3(site3: string, code: string, since: number, signal?: AbortSignal, until?: number): Promise<RemoteFile[]> {
  const keys = (await Promise.all(days(since, until ?? Date.now()).map((d) => list(L3_BUCKET, `${site3}_${code}_${ymd(d, "_")}`, signal)))).flat();
  return keys
    .map((key) => ({ key, url: `${L3_BUCKET}/${key}`, time: l3Time(key) }))
    .filter(within(since, until))
    .sort((a, b) => a.time - b.time);
}

/** Level II volumes for an ICAO since `since` (up to `until`, looking back), oldest first. */
export async function listLevel2(icao: string, since: number, signal?: AbortSignal, until?: number): Promise<RemoteFile[]> {
  const keys = (await Promise.all(days(since, until ?? Date.now()).map((d) => list(L2_BUCKET, `${ymd(d, "/")}/${icao}/`, signal)))).flat();
  return keys
    .map((key) => ({ key, url: `${L2_BUCKET}/${key}`, time: l2Time(key) }))
    .filter(within(since, until))
    .sort((a, b) => a.time - b.time);
}

/** The newest `count` files, thinned evenly if there are more. */
export function newest(files: readonly RemoteFile[], count: number): RemoteFile[] {
  if (files.length <= count) return [...files];
  return files.slice(-count);
}

// ── Real-time chunks ────────────────────────────────────────────────────────
// The archive bucket publishes each volume once it's complete, about 11
// minutes after its scan starts. Its sibling publishes the volume as it's
// scanned, in chunks of about 120 radials: `KTLX/893/20261020-181800-001-S`
// (volume number 1–999, reused in a cycle; scan start; chunk number; S starts
// the volume, I is intermediate, E ends it). The chunks concatenated in order
// are an ordinary Archive II file, complete or not.

export const L2_CHUNKS_BUCKET = "https://unidata-nexrad-level2-chunks.s3.amazonaws.com";

export interface ChunkVolume {
  /** Volume number, 1–999. */
  volume: number;
  /** Scan start, epoch ms. */
  time: number;
  /** Chunk URLs in order. */
  urls: string[];
  /** The end chunk has arrived. */
  done: boolean;
}

/** `KTLX/893/20261020-181800-001-S` → its parts, or null for other keys. */
export function parseChunkKey(key: string): { volume: number; time: number; seq: number; kind: "S" | "I" | "E" } | null {
  const m = key.match(/\/(\d{1,3})\/(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(\d{3})-([SIE])$/);
  if (!m) return null;
  return { volume: +m[1]!, time: Date.UTC(+m[2]!, +m[3]! - 1, +m[4]!, +m[5]!, +m[6]!, +m[7]!), seq: +m[8]!, kind: m[9] as "S" | "I" | "E" };
}

/** A volume's chunks (null when there are none), in order. A volume number reused mid-listing keeps only the newest scan's chunks. */
export function chunkVolume(keys: readonly string[]): ChunkVolume | null {
  const parsed = keys.map((key) => ({ key, p: parseChunkKey(key) })).filter((x) => x.p != null);
  if (!parsed.length) return null;
  const time = Math.max(...parsed.map((x) => x.p!.time));
  const own = parsed.filter((x) => x.p!.time === time).sort((a, b) => a.p!.seq - b.p!.seq);
  // Without the start chunk (it holds the volume header) there's nothing to decode.
  if (own[0]!.p!.kind !== "S") return null;
  // Only the unbroken run from the start: a chunk that's late would leave a hole.
  const run = own.filter((x, i) => x.p!.seq === i + 1);
  return { volume: own[0]!.p!.volume, time, urls: run.map((x) => `${L2_CHUNKS_BUCKET}/${x.key}`), done: run.at(-1)!.p!.kind === "E" };
}

export const nextVolume = (v: number) => (v % 999) + 1;
export const prevVolume = (v: number) => ((v + 997) % 999) + 1;

/**
 * Volume numbers most likely to be the newest: the one before each of the
 * largest gaps in the cycle (the bucket also keeps stray volumes from earlier
 * days, so the biggest gap alone can mislead).
 */
export function newestCandidates(volumes: readonly number[], count = 4): number[] {
  const v = [...new Set(volumes)].sort((a, b) => a - b);
  if (v.length <= 1) return v;
  return v
    .map((n, i) => ({ n, gap: (i + 1 < v.length ? v[i + 1]! : v[0]! + 999) - n }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, count)
    .map((x) => x.n);
}

async function listVolume(icao: string, volume: number, signal?: AbortSignal): Promise<ChunkVolume | null> {
  return chunkVolume(await list(L2_CHUNKS_BUCKET, `${icao}/${volume}/`, signal));
}

/** Finds the volume being scanned now: the gaps in the listing narrow it down, the scan times decide. */
async function discoverNewest(icao: string, signal?: AbortSignal): Promise<ChunkVolume | null> {
  const res = await fetch(`${L2_CHUNKS_BUCKET}/?list-type=2&delimiter=/&prefix=${encodeURIComponent(`${icao}/`)}`, { signal });
  if (!res.ok) throw new Error(`S3 listing failed: ${res.status}`);
  const volumes = [...(await res.text()).matchAll(/<Prefix>[A-Z0-9]+\/(\d+)\/<\/Prefix>/g)].map((m) => +m[1]!);
  const found = await Promise.all(newestCandidates(volumes).map((n) => listVolume(icao, n, signal)));
  return found.reduce<ChunkVolume | null>((best, v) => (v && (!best || v.time > best.time) ? v : best), null);
}

/** Per radar: the newest volume seen, and finished volumes (their chunks don't change). */
const live = new Map<string, { newest: number; time: number; done: Map<number, ChunkVolume> }>();

/**
 * The radar's latest `count` volumes from the real-time chunks, oldest first;
 * the last is usually still being scanned. Polling costs two small listings
 * once the newest volume is known.
 */
export async function liveVolumes(icao: string, count: number, signal?: AbortSignal): Promise<ChunkVolume[]> {
  let state = live.get(icao);
  if (!state) {
    const newest = await discoverNewest(icao, signal);
    if (!newest) return [];
    state = { newest: newest.volume, time: newest.time, done: new Map() };
    live.set(icao, state);
  }
  // Catch up with volumes started since the last look.
  const fresh = new Map<number, ChunkVolume>();
  for (let i = 0; i < 6; i++) {
    const after = await listVolume(icao, nextVolume(state.newest), signal);
    // Not a stray from an earlier cycle.
    if (!after || after.time <= state.time) break;
    state.newest = after.volume;
    state.time = after.time;
    fresh.set(after.volume, after);
    if (after.done) state.done.set(after.volume, after);
  }
  const out: ChunkVolume[] = [];
  for (let v = state.newest, i = 0; i < count; v = prevVolume(v), i++) {
    const vol = state.done.get(v) ?? fresh.get(v) ?? (await listVolume(icao, v, signal));
    if (!vol) break;
    // Scans an hour apart aren't one loop (a volume number from an earlier cycle, or an outage).
    if (out.length && out.at(-1)!.time - vol.time > 3_600_000) break;
    if (vol.done) state.done.set(v, vol);
    out.push(vol);
  }
  // Drop finished volumes that have left the loop.
  for (const v of state.done.keys()) if (!out.some((x) => x.volume === v)) state.done.delete(v);
  return out.reverse();
}
