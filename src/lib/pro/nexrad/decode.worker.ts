/// <reference lib="webworker" />
/**
 * Decodes NEXRAD files off the main thread: fetch → bzip2 → the compact
 * sweep (Level II velocity dealiased when asked), plus a colour per raw level. The map draws it on the GPU
 * (sweep-layer.ts) and the cursor readout reads exact gate values from it. Products worked out from a
 * volume (storm-relative velocity, NROT, debris: derive.ts) and max value trails (trail.ts) are made
 * here too, so the page never waits on them.
 */
import { DECODED_SCALES } from "../scales";
import { dealiasSweep } from "./dealias";
import { deriveLevel2, type TdsMark } from "./derive";
import { gunzipIfNeeded } from "./gzip";
import { parseLevel2, parseLevel2Volume } from "./level2";
import { parseLevel3 } from "./level3";
import type { DecodeRequest, DecodeResponse, TrailResponse, VolumeResponse } from "./protocol";
import { sweepColors, type Sweep } from "./sweep";
import { maxTrails } from "./trail";

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

/** A sweep's arrays, moved to the main thread rather than copied. */
const buffersOf = (s: Sweep) => [s.data.buffer, s.azStart.buffer, s.azWidth.buffer, s.table.buffer, ...(s.nyquist ? [s.nyquist.buffer] : [])];

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const req = e.data;
  if (req.kind === "l2volume") {
    try {
      const r = parseLevel2Volume(await volume(req.url), req.moment, { site: req.site });
      const buffers = r.sweeps.flatMap(buffersOf);
      self.postMessage({ id: req.id, ok: true, sweeps: r.sweeps, complete: r.complete } satisfies VolumeResponse, buffers as Transferable[]);
    } catch (err) {
      self.postMessage({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies VolumeResponse);
    }
    return;
  }
  if (req.kind === "trail") {
    try {
      const sweeps = maxTrails(req.key, req.sweeps, req.signed);
      const colors = sweeps.map((s) => sweepColors(s, req.scale));
      self.postMessage({ id: req.id, ok: true, sweeps, colors } satisfies TrailResponse, [...sweeps.flatMap(buffersOf), ...colors.map((c) => c.buffer)] as Transferable[]);
    } catch (err) {
      self.postMessage({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies TrailResponse);
    }
    return;
  }
  try {
    let sweep: Sweep | null;
    let cuts: number[] = [];
    let complete = true;
    let marks: TdsMark[] | undefined;
    if (req.kind === "l3") {
      sweep = parseLevel3(await fetchBytes(req.url));
    } else {
      const file = req.kind === "l2chunks" ? await chunkedVolume(req.urls) : await volume(req.url);
      const site = req.kind === "l2" ? req.site : undefined;
      let error = "No such cut in this volume";
      if (req.derive) {
        const r = deriveLevel2(file, req.kind === "l2" ? req.url : `${req.urls[0]}|${req.urls.length}`, req.angle, req.derive, { site, dealias: req.dealias });
        ({ sweep, complete, cuts, marks } = r);
        error = r.error ?? error;
      } else {
        const r = parseLevel2(file, req.moment, req.angle, { site });
        sweep = r.sweep && req.dealias && req.moment === "VEL" ? dealiasSweep(r.sweep) : r.sweep;
        complete = r.complete;
        cuts = r.cuts.map((c) => c.angle);
      }
      if (!sweep) {
        self.postMessage({ id: req.id, ok: false, error, empty: true, cuts } satisfies DecodeResponse);
        return;
      }
    }
    const colors = sweepColors(sweep, DECODED_SCALES[req.scale]);
    const msg: DecodeResponse = { id: req.id, ok: true, sweep, colors, cuts, complete, ...(marks && { marks }) };
    self.postMessage(msg, [...buffersOf(sweep), colors.buffer] as Transferable[]);
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies DecodeResponse);
  }
};
