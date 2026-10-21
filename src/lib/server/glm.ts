import "server-only";
import * as hdf5 from "jsfive";
import { HttpError } from "../api/http";
import { parseKeys } from "../pro/nexrad/aws";
import type { Bbox, LightningFile } from "../radar/lightning";

/**
 * Lightning for the map's bolts: GOES Geostationary Lightning Mapper (GLM)
 * flashes, read straight from NOAA's open data on AWS, so the app needs no
 * Pro data server for them. Each satellite writes a GLM-L2-LCFA file every 20
 * seconds with the flashes it saw in them; this keeps the last 15 minutes
 * from GOES-East and GOES-West in memory, fetching only the files it hasn't
 * read yet, and answers for a map area. As in pro-server's glm.py, each
 * satellite is used on its own side of 106°W, so a flash in the overlap
 * (which both see) counts once.
 */

export const GLM_MINUTES = 15;
const SATELLITES = [
  { bucket: "https://noaa-goes19.s3.amazonaws.com", west: false }, // GOES-East
  { bucket: "https://noaa-goes18.s3.amazonaws.com", west: true }, // GOES-West
] as const;
const SPLIT_LON = -106;
/** Each file covers 20 s; its flashes are dated at the middle (±10 s is plenty for a map). */
const FILE_MS = 20_000;
/** A new file every 20 s: no point looking more often. */
const REFRESH_MS = 20_000;
/** How long an answer waits for new files once the window has some; the read carries on for the next one. */
const WAIT_MS = 8_000;
const TIMEOUT_MS = 20_000;
const PARALLEL = 6;
/** Newest flashes per answer: a busy evening can put tens of thousands in view. */
export const MAX_FLASHES = 6_000;

const HOUR_MS = 3_600_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** `…_G19_s20262941157000_e…` → the scan's start, epoch ms (NaN for other names). */
export function glmKeyTime(key: string): number {
  const m = key.match(/_s(\d{4})(\d{3})(\d\d)(\d\d)(\d\d)(\d)/);
  if (!m) return NaN;
  const [y, doy, h, mi, s, tenth] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  // Day-of-year as the day of January: Date.UTC carries it into the right month.
  return Date.UTC(y, 0, doy, h, mi, s, tenth * 100);
}

/** The bucket folder for the hour starting at `hour` (epoch ms): `GLM-L2-LCFA/2026/294/11/`. */
function hourPrefix(hour: number): string {
  const d = new Date(hour);
  const doy = Math.floor((hour - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
  return `GLM-L2-LCFA/${d.getUTCFullYear()}/${pad(doy, 3)}/${pad(d.getUTCHours())}/`;
}

/** The good-quality flash centroids in one LCFA file. Throws when the file can't be read. */
export function readFlashes(bytes: ArrayBuffer): { lon: Float32Array; lat: Float32Array } {
  let file: hdf5.File;
  try {
    file = new hdf5.File(bytes, "glm.nc");
  } catch (err) {
    // jsfive throws strings and other non-Errors.
    throw new Error(`not a GLM file (${err instanceof Error ? err.message : String(err)})`);
  }
  const values = (name: string, required: boolean): ArrayLike<number> | null => {
    let ds: hdf5.Dataset | hdf5.Group;
    try {
      ds = file.get(name);
    } catch {
      if (required) throw new Error(`no ${name} in the GLM file`);
      return null;
    }
    if (!(ds instanceof hdf5.Dataset)) throw new Error(`${name} isn't a variable`);
    return ds.shape[0] === 0 ? [] : ds.value;
  };
  const lat = values("flash_lat", true)!;
  const lon = values("flash_lon", true)!;
  const quality = values("flash_quality_flag", false);
  if (lat.length !== lon.length) throw new Error("flash_lat and flash_lon differ in length");
  const keep: number[] = [];
  for (let i = 0; i < lat.length; i++) {
    if (Number.isFinite(lat[i]) && Number.isFinite(lon[i]) && (!quality || quality[i] === 0)) keep.push(i);
  }
  return { lon: Float32Array.from(keep, (i) => lon[i]!), lat: Float32Array.from(keep, (i) => lat[i]!) };
}

interface Chunk {
  /** The middle of the file's 20 s, epoch ms. */
  time: number;
  lon: Float32Array;
  lat: Float32Array;
}

/** The rolling window of flashes from both satellites. One per server process (`glmFlashes`); tests make their own. */
export class GlmWindow {
  /** Read files by key: the ones still in the window, so each is fetched once. */
  private chunks = new Map<string, Chunk>();
  private polled = -Infinity;
  private reading: Promise<boolean> | null = null;

  constructor(private readonly get: typeof fetch = (input, init) => fetch(input, init)) {}

  /**
   * Fetches the files of the last 15 minutes not read yet, newest first, and
   * drops the ones that have left the window. Resolves false when neither
   * satellite could be listed. A file that can't be read (half-written,
   * damaged) is tried again next time.
   */
  async refresh(now = Date.now()): Promise<boolean> {
    this.polled = now;
    const since = now - GLM_MINUTES * 60_000 - FILE_MS;
    const hours: number[] = [];
    for (let h = Math.floor(since / HOUR_MS) * HOUR_MS; h <= now; h += HOUR_MS) hours.push(h);
    const todo: { key: string; url: string; time: number; west: boolean }[] = [];
    let listed = 0;
    await Promise.all(
      SATELLITES.flatMap((sat) =>
        hours.map(async (hour) => {
          try {
            const res = await this.get(`${sat.bucket}/?list-type=2&prefix=${encodeURIComponent(hourPrefix(hour))}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (!res.ok) throw new Error(`listing answered ${res.status}`);
            const keys = parseKeys(await res.text());
            listed++;
            for (const key of keys) {
              const time = glmKeyTime(key);
              if (time >= since && !this.chunks.has(key)) todo.push({ key, url: `${sat.bucket}/${key}`, time, west: sat.west });
            }
          } catch (err) {
            console.warn(`[glm] listing ${sat.bucket} failed: ${err instanceof Error ? err.message : err}`);
          }
        }),
      ),
    );
    todo.sort((a, b) => b.time - a.time);
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        for (let f = todo.shift(); f; f = todo.shift()) {
          try {
            const res = await this.get(f.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (!res.ok) throw new Error(`answered ${res.status}`);
            const { lon, lat } = readFlashes(await res.arrayBuffer());
            // This satellite's side of the split only.
            const keep: number[] = [];
            for (let i = 0; i < lon.length; i++) if (f.west ? lon[i]! < SPLIT_LON : lon[i]! >= SPLIT_LON) keep.push(i);
            this.chunks.set(f.key, { time: f.time + FILE_MS / 2, lon: Float32Array.from(keep, (i) => lon[i]!), lat: Float32Array.from(keep, (i) => lat[i]!) });
          } catch (err) {
            console.warn(`[glm] skipping ${f.key}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }),
    );
    for (const [key, c] of this.chunks) if (c.time < since) this.chunks.delete(key);
    return listed > 0;
  }

  /** The flashes of the last 15 minutes in `bbox`, oldest first, up to MAX_FLASHES of the newest. */
  query(bbox: Bbox, now = Date.now()): LightningFile {
    const [w, s, e, n] = bbox;
    const since = now - GLM_MINUTES * 60_000;
    const flashes: [number, number, number][] = [];
    for (const c of this.chunks.values()) {
      if (c.time < since) continue;
      const ago = Math.max(0, Math.round((now - c.time) / 1000));
      for (let i = 0; i < c.lon.length; i++) {
        const x = c.lon[i]!;
        const y = c.lat[i]!;
        if (x >= w && x <= e && y >= s && y <= n) flashes.push([round3(x), round3(y), ago]);
      }
    }
    flashes.sort((a, b) => b[2] - a[2]);
    return { generated: new Date(now).toISOString(), minutes: GLM_MINUTES, flashes: flashes.length > MAX_FLASHES ? flashes.slice(-MAX_FLASHES) : flashes };
  }

  /**
   * `query`, after reading any new files: the first answer waits for the
   * window to fill, later ones a few seconds at most (the read carries on).
   * Throws when the window is empty because NOAA's bucket can't be reached.
   */
  async flashes(bbox: Bbox, now = Date.now()): Promise<LightningFile> {
    if (now - this.polled >= REFRESH_MS) {
      const reading = (this.reading ??= this.refresh(now).finally(() => (this.reading = null)));
      const ok = await (this.chunks.size ? Promise.race([reading, new Promise<boolean>((r) => setTimeout(() => r(true), WAIT_MS))]) : reading);
      if (!ok && !this.chunks.size) throw new HttpError("GOES lightning data can't be reached right now", 503);
    }
    return this.query(bbox, now);
  }
}

const shared = new GlmWindow();

/** GOES GLM flashes of the last 15 minutes in `bbox`, for GET /api/lightning/flashes. */
export const glmFlashes = (bbox: Bbox) => shared.flashes(bbox);
