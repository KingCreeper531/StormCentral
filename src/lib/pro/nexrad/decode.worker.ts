/// <reference lib="webworker" />
/**
 * Decodes NEXRAD files off the main thread: fetch → bzip2 → the compact
 * sweep, plus a colour per raw level. The map draws it on the GPU
 * (sweep-layer.ts) and the cursor readout reads exact gate values from it.
 */
import { DECODED_SCALES } from "../scales";
import { gunzipIfNeeded } from "./gzip";
import { parseLevel2 } from "./level2";
import { parseLevel3 } from "./level3";
import type { DecodeRequest, DecodeResponse } from "./protocol";
import { sweepColors, type Sweep } from "./sweep";

declare const self: DedicatedWorkerGlobalScope;

/** Recent Level II volumes (gunzipped), so changing tilt doesn't download the volume again. */
const volumes = new Map<string, Promise<Uint8Array>>();
const MAX_VOLUMES = 4;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function volume(url: string): Promise<Uint8Array> {
  let p = volumes.get(url);
  if (p) {
    volumes.delete(url);
    volumes.set(url, p);
    return p;
  }
  p = fetchBytes(url).then(gunzipIfNeeded);
  p.catch(() => volumes.delete(url));
  volumes.set(url, p);
  while (volumes.size > MAX_VOLUMES) volumes.delete(volumes.keys().next().value!);
  return p;
}

/** Real-time chunks (they never change once published), shared by the volumes that use them. */
const chunks = new Map<string, Promise<Uint8Array>>();
const MAX_CHUNKS = 240;

function chunk(url: string): Promise<Uint8Array> {
  let p = chunks.get(url);
  if (!p) {
    p = fetchBytes(url);
    p.catch(() => chunks.delete(url));
    chunks.set(url, p);
    while (chunks.size > MAX_CHUNKS) chunks.delete(chunks.keys().next().value!);
  }
  return p;
}

async function chunkedVolume(urls: readonly string[]): Promise<Uint8Array> {
  const parts = await Promise.all(urls.map(chunk));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const req = e.data;
  try {
    let sweep: Sweep | null;
    let cuts: number[] = [];
    let complete = true;
    if (req.kind === "l3") {
      sweep = parseLevel3(await fetchBytes(req.url));
    } else {
      const file = req.kind === "l2chunks" ? await chunkedVolume(req.urls) : await volume(req.url);
      const r = parseLevel2(file, req.moment, req.angle, { site: req.kind === "l2" ? req.site : undefined });
      sweep = r.sweep;
      complete = r.complete;
      cuts = r.cuts.map((c) => c.angle);
      if (!sweep) {
        self.postMessage({ id: req.id, ok: false, error: "No such cut in this volume", empty: true, cuts } satisfies DecodeResponse);
        return;
      }
    }
    const colors = sweepColors(sweep, DECODED_SCALES[req.scale]);
    const msg: DecodeResponse = { id: req.id, ok: true, sweep, colors, cuts, complete };
    self.postMessage(msg, [sweep.data.buffer, sweep.azStart.buffer, sweep.azWidth.buffer, sweep.table.buffer, colors.buffer] as Transferable[]);
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies DecodeResponse);
  }
};
