/// <reference lib="webworker" />
/**
 * Builds the 3D view's shaded surfaces (lib/pro/isosurface) off the main
 * thread. Volumes are sent once and kept here by key, so moving a threshold
 * only sends the request. Velocity is dealiased once, as it arrives.
 */
import { buildSurfaces, surfaceBuffers, type SurfaceMessage, type SurfaceReply } from "./isosurface";
import { dealiasSweep } from "./nexrad/dealias";
import type { Sweep } from "./nexrad/sweep";

declare const self: DedicatedWorkerGlobalScope;

/** Reflectivity and velocity of the newest volume, and the one before: tens of megabytes each. */
const volumes = new Map<string, Sweep[]>();
const MAX_VOLUMES = 3;

self.onmessage = (e: MessageEvent<SurfaceMessage>) => {
  const m = e.data;
  for (const v of m.volumes) {
    volumes.delete(v.key);
    volumes.set(v.key, v.key === m.vel ? v.sweeps.map(dealiasSweep) : v.sweeps);
    while (volumes.size > MAX_VOLUMES) volumes.delete(volumes.keys().next().value!);
  }
  const ref = volumes.get(m.ref);
  const vel = m.vel ? volumes.get(m.vel) : null;
  if (!ref || (m.vel && !vel)) {
    self.postMessage({ id: m.id, ok: false, error: "volume not here", missing: true } satisfies SurfaceReply);
    return;
  }
  try {
    const set = buildSurfaces(ref, vel ?? null, m.req);
    self.postMessage({ id: m.id, ok: true, set } satisfies SurfaceReply, surfaceBuffers(set));
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies SurfaceReply);
  }
};
