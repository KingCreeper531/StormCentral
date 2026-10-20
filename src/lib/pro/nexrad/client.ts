"use client";
/**
 * Main-thread side of NEXRAD decoding: a small pool of decode workers, a
 * cache of decoded frames (the sweep and its colours, drawn on the GPU and
 * sampled exactly), and a subscription so frame sources re-render as frames
 * arrive.
 */
import type { DecodedScaleId } from "../scales";
import type { Moment } from "./level2";
import type { DecodeRequest, DecodeResponse } from "./protocol";
import { azimuthIndex, levelAt, type Sweep } from "./sweep";

export interface DecodedFrame {
  key: string;
  sweep: Sweep;
  /** RGBA per raw level. */
  colors: Uint8Array;
  cuts: number[];
  /** The sweep ran to its end (a volume still arriving can hold part of one). */
  complete: boolean;
  /** Lazily built azimuth lookup for sampling. */
  azLut?: Int32Array;
}

export type DecodeJob =
  | { kind: "l3"; url: string; scale: DecodedScaleId }
  /** `site`: the radar's location, for volumes from before 2008 that don't carry it. */
  | { kind: "l2"; url: string; moment: Moment; angle: number; scale: DecodedScaleId; site?: { lat: number; lon: number } }
  /** A volume still being scanned, from its real-time chunks so far. */
  | { kind: "l2chunks"; urls: string[]; moment: Moment; angle: number; scale: DecodedScaleId };

type ChunkJob = Extract<DecodeJob, { kind: "l2chunks" }>;

/** The same sweep of a live volume, however many chunks have arrived. */
const chunkGroup = (j: ChunkJob) => `l2c|${j.urls[0]}|${j.moment}|${j.angle}|${j.scale}`;

/** The first complete decode of each live sweep: later chunks don't change it, so it isn't decoded again. */
const settled = new Map<string, ChunkJob>();

/** A live sweep's job: the one that completed it, once one has. */
export const liveJob = (job: ChunkJob): DecodeJob => settled.get(chunkGroup(job)) ?? job;

export const jobKey = (j: DecodeJob) =>
  j.kind === "l3" ? `l3|${j.url}|${j.scale}` : j.kind === "l2" ? `l2|${j.url}|${j.moment}|${j.angle}|${j.scale}` : `${chunkGroup(j)}|${j.urls.length}`;

type Entry = { state: "pending" } | { state: "done"; frame: DecodedFrame } | { state: "error"; error: string; cuts?: number[]; at: number };

/** Failed decodes (a dropped download, say) are retried after this long. */
const RETRY_MS = 60_000;
/** A decode taking this long (download included) is stuck: the pool is replaced so the rest can go on. */
const JOB_TIMEOUT_MS = 120_000;

const MAX_ENTRIES = 90;
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}

export function subscribeDecoded(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const decodedVersion = () => version;
export const peekDecoded = (key: string) => entries.get(key);

// ── Worker pool ─────────────────────────────────────────────────────────────

let pool: Worker[] | null = null;
let rr = 0;
let nextId = 1;
const waiting = new Map<number, (r: DecodeResponse) => void>();

/** Fail everything in flight and drop the workers; the next request starts a fresh pool. */
function resetPool(error: string) {
  for (const [id, resolve] of waiting) resolve({ id, ok: false, error });
  waiting.clear();
  for (const x of pool ?? []) x.terminate();
  pool = null;
}

function workers(): Worker[] {
  if (pool) return pool;
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 2) : 2;
  const size = Math.max(1, Math.min(3, cores - 1));
  pool = Array.from({ length: size }, () => {
    // A classic worker: Turbopack's worker bootstrap loads its chunks with importScripts.
    const w = new Worker(new URL("./decode.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<DecodeResponse>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    // A worker that can't start (or crashes, out of memory say) fails what's in flight; those are retried later.
    w.onerror = (e) => {
      e.preventDefault();
      resetPool(e.message || "Decoder failed");
    };
    return w;
  });
  return pool;
}

function run(job: DecodeJob): Promise<DecodeResponse> {
  const id = nextId++;
  const req = { ...job, id } as DecodeRequest;
  return new Promise((resolve) => {
    const timer = setTimeout(() => waiting.has(id) && resetPool("Decoder timed out"), JOB_TIMEOUT_MS);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    const ws = workers();
    ws[rr++ % ws.length]!.postMessage(req);
  });
}

function evict() {
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** Decode (once) and cache; listeners are notified when it lands. */
export function requestDecode(job: DecodeJob): void {
  const key = jobKey(job);
  const hit = entries.get(key);
  if (hit?.state === "error" && Date.now() - hit.at > RETRY_MS) entries.delete(key);
  else if (hit) {
    // Refresh recency.
    entries.delete(key);
    entries.set(key, hit);
    return;
  }
  entries.set(key, { state: "pending" });
  evict();
  void run(job).then((r) => {
    if (!entries.has(key)) return;
    if (r.ok) entries.set(key, { state: "done", frame: { key, sweep: r.sweep, colors: r.colors, cuts: r.cuts, complete: r.complete } });
    else entries.set(key, { state: "error", error: r.error, cuts: r.cuts, at: Date.now() });
    if (job.kind === "l2chunks") {
      const group = chunkGroup(job);
      if (r.ok && r.complete && !settled.has(group)) {
        settled.set(group, job);
        while (settled.size > 60) settled.delete(settled.keys().next().value!);
      }
      retire(job);
    }
    notify();
  });
}

/**
 * A live sweep is decoded again as chunks arrive; the earlier, partial
 * decodes are dropped once the map has had time to swap in the new one.
 */
function retire(job: ChunkJob) {
  const group = `${chunkGroup(job)}|`;
  const keep = settled.get(chunkGroup(job));
  const kept = keep ? jobKey(keep) : null;
  const stale = [...entries.keys()].filter((k) => k !== kept && k.startsWith(group) && Number(k.slice(group.length)) < job.urls.length);
  if (!stale.length) return;
  setTimeout(() => {
    for (const k of stale) entries.delete(k);
  }, 20_000);
}

/** Exact raw value under a point for a decoded frame, or null outside it / no data. */
export function decodedValueAt(key: string, lat: number, lon: number): { value: number | null; special: string | null } | null {
  const e = entries.get(key);
  if (e?.state !== "done") return null;
  const f = e.frame;
  f.azLut ??= azimuthIndex(f.sweep);
  const lvl = levelAt(f.sweep, lat, lon, f.azLut);
  if (lvl < 0) return null;
  const sp = f.sweep.special.find((s) => s.level === lvl);
  if (sp) return { value: null, special: sp.label };
  const v = f.sweep.table[lvl];
  return { value: v == null || Number.isNaN(v) ? null : v, special: null };
}
