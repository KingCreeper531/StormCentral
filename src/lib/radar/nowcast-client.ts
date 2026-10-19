/**
 * Runs future-radar jobs on one shared worker (nowcast.worker.ts). Only the
 * newest job matters: starting one supersedes the rest.
 */
import type { NowcastJob, NowcastResponse } from "./nowcast";

let worker: Worker | null = null;
/** Set when the worker can't start here: no more attempts this session. */
let broken = false;
let nextId = 1;
const waiting = new Map<number, (r: NowcastResponse) => void>();

/** Workers that can draw (OffscreenCanvas) are needed; without them there's simply no future radar. */
export const nowcastSupported = () => !broken && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

function getWorker(): Worker | null {
  if (worker || !nowcastSupported()) return worker;
  try {
    // A classic worker: Turbopack's worker bootstrap loads its chunks with importScripts.
    const w = new Worker(new URL("./nowcast.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<NowcastResponse>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    w.onerror = (e) => {
      e.preventDefault();
      for (const [id, resolve] of waiting) resolve({ id, ok: false, skipped: false, error: e.message || "Future radar failed" });
      waiting.clear();
      w.terminate();
      worker = null;
      broken = true;
    };
    worker = w;
  } catch {
    broken = true;
  }
  return worker;
}

/** Starts a job, superseding any other; `cancel` stops it. */
export function runNowcast(job: Omit<NowcastJob, "type" | "id">): { promise: Promise<NowcastResponse>; cancel: () => void } {
  const id = nextId++;
  const w = getWorker();
  if (!w) return { promise: Promise.resolve({ id, ok: false, skipped: true }), cancel: () => {} };
  // The worker drops superseded jobs without answering: settle them here.
  for (const [other, resolve] of waiting) resolve({ id: other, ok: false, skipped: true });
  waiting.clear();
  const promise = new Promise<NowcastResponse>((resolve) => waiting.set(id, resolve));
  w.postMessage({ ...job, type: "run", id } satisfies NowcastJob);
  return {
    promise,
    cancel: () => {
      waiting.get(id)?.({ id, ok: false, skipped: true });
      waiting.delete(id);
      w.postMessage({ type: "cancel", id });
    },
  };
}
