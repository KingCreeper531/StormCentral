"use client";
/**
 * Main-thread side of the 3D view's surfaces: one worker
 * (isosurface.worker.ts) that keeps the volumes it was sent and builds the
 * shells on request.
 */
import type { SurfaceMessage, SurfaceReply, SurfaceRequest, SurfaceSet } from "./isosurface";
import type { Sweep } from "./nexrad/sweep";

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (r: SurfaceReply) => void>();
/** Volumes the worker was sent (it may have let some go since: it says so, and they're sent again). */
const sent = new Set<string>();

function reset(error: string) {
  for (const [id, resolve] of waiting) resolve({ id, ok: false, error });
  waiting.clear();
  sent.clear();
  worker?.terminate();
  worker = null;
}

function post(m: Omit<SurfaceMessage, "id">): Promise<SurfaceReply> {
  if (!worker) {
    // A classic worker, like the decoders (Turbopack's worker bootstrap loads its chunks with importScripts).
    worker = new Worker(new URL("./isosurface.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<SurfaceReply>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      reset(e.message || "Surface builder failed");
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ ...m, id } satisfies SurfaceMessage);
  });
}

export interface SurfaceVolume {
  /** Names the volume and moment (its URL and "REF", say). */
  key: string;
  sweeps: Sweep[];
}

/** The shells for a request, from the reflectivity volume (and the velocity one, for velocity shells). */
export async function buildSurfacesOffThread(ref: SurfaceVolume, vel: SurfaceVolume | null, req: SurfaceRequest): Promise<SurfaceSet> {
  const vols = [ref, ...(vel ? [vel] : [])];
  for (let attempt = 0; attempt < 2; attempt++) {
    const volumes = vols.filter((v) => !sent.has(v.key));
    // Marked before the answer: messages arrive in order, so a request sent meanwhile finds them there.
    for (const v of volumes) sent.add(v.key);
    while (sent.size > 8) sent.delete(sent.values().next().value!);
    const r = await post({ volumes, ref: ref.key, vel: vel?.key ?? null, req });
    if (r.ok) return r.set;
    if (!r.missing) throw new Error(r.error);
    for (const v of vols) sent.delete(v.key);
  }
  throw new Error("The surface builder lost the volume");
}
