"use client";
/**
 * Main-thread side of NEXRAD decoding: a small pool of decode workers, a
 * cache of decoded frames (image blob URL + sweep for exact sampling), and a
 * subscription so frame sources re-render as frames arrive.
 */
import type { DecodedScaleId } from "../scales";
import type { Moment } from "./level2";
import type { DecodeRequest, DecodeResponse } from "./protocol";
import { azimuthIndex, levelAt, type Sweep } from "./sweep";

export interface DecodedFrame {
  key: string;
  url: string;
  bounds: [number, number, number, number];
  sweep: Sweep;
  cuts: number[];
  /** Lazily built azimuth lookup for sampling. */
  azLut?: Int32Array;
}

export type DecodeJob =
  | { kind: "l3"; url: string; scale: DecodedScaleId; maxPx: number }
  | { kind: "l2"; url: string; moment: Moment; angle: number; scale: DecodedScaleId; maxPx: number };

export const jobKey = (j: DecodeJob) => (j.kind === "l3" ? `l3|${j.url}|${j.maxPx}` : `l2|${j.url}|${j.moment}|${j.angle}|${j.maxPx}`);

type Entry = { state: "pending" } | { state: "done"; frame: DecodedFrame } | { state: "error"; error: string; cuts?: number[]; at: number };

/** Failed decodes (a dropped download, say) are retried after this long. */
const RETRY_MS = 60_000;

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
    // A worker that can't start (or crashes) fails everything it holds; the next request starts a fresh pool.
    w.onerror = (e) => {
      e.preventDefault();
      for (const [id, resolve] of waiting) resolve({ id, ok: false, error: e.message || "Decoder failed" });
      waiting.clear();
      for (const x of pool ?? []) x.terminate();
      pool = null;
    };
    return w;
  });
  return pool;
}

function run(job: DecodeJob): Promise<DecodeResponse> {
  const id = nextId++;
  const req = { ...job, id } as DecodeRequest;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    const ws = workers();
    ws[rr++ % ws.length]!.postMessage(req);
  });
}

function evict() {
  while (entries.size > MAX_ENTRIES) {
    const [key, e] = entries.entries().next().value!;
    if (e.state === "done") URL.revokeObjectURL(e.frame.url);
    entries.delete(key);
  }
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
    if (r.ok) entries.set(key, { state: "done", frame: { key, url: URL.createObjectURL(r.image), bounds: r.bounds, sweep: r.sweep, cuts: r.cuts } });
    else entries.set(key, { state: "error", error: r.error, cuts: r.cuts, at: Date.now() });
    notify();
  });
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
