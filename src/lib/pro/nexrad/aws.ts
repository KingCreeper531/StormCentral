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

/** `…/KTLX20261019_155210_V06` → epoch ms (NaN for other files, e.g. _MDM). */
export function l2Time(key: string): number {
  const m = key.match(/[A-Z]{4}(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)_V\d\d$/);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : NaN;
}

async function list(bucket: string, prefix: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${bucket}/?list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`, { signal });
  if (!res.ok) throw new Error(`S3 listing failed: ${res.status}`);
  return parseKeys(await res.text());
}

/** Days (UTC) covering `since`…now, newest last. */
const days = (since: number, now: number) => (ymd(since, "") === ymd(now, "") ? [now] : [since, now]);

/** Level III files for a 3-letter site and product code since `since`, oldest first. */
export async function listLevel3(site3: string, code: string, since: number, signal?: AbortSignal, now = Date.now()): Promise<RemoteFile[]> {
  const keys = (await Promise.all(days(since, now).map((d) => list(L3_BUCKET, `${site3}_${code}_${ymd(d, "_")}`, signal)))).flat();
  return keys
    .map((key) => ({ key, url: `${L3_BUCKET}/${key}`, time: l3Time(key) }))
    .filter((f) => f.time >= since)
    .sort((a, b) => a.time - b.time);
}

/** Level II volumes for an ICAO since `since`, oldest first. */
export async function listLevel2(icao: string, since: number, signal?: AbortSignal, now = Date.now()): Promise<RemoteFile[]> {
  const keys = (await Promise.all(days(since, now).map((d) => list(L2_BUCKET, `${ymd(d, "/")}/${icao}/`, signal)))).flat();
  return keys
    .map((key) => ({ key, url: `${L2_BUCKET}/${key}`, time: l2Time(key) }))
    .filter((f) => f.time >= since)
    .sort((a, b) => a.time - b.time);
}

/** The newest `count` files, thinned evenly if there are more. */
export function newest(files: readonly RemoteFile[], count: number): RemoteFile[] {
  if (files.length <= count) return [...files];
  return files.slice(-count);
}
