/// <reference lib="webworker" />
/**
 * Decodes NEXRAD files off the main thread: fetch → bzip2 → sweep → a Web
 * Mercator RGBA image (PNG blob) for MapLibre, plus the compact sweep itself
 * so the cursor readout can read exact gate values.
 */
import { DECODED_SCALES, scaleColor } from "../scales";
import { gunzipIfNeeded } from "./gzip";
import { parseLevel2 } from "./level2";
import { parseLevel3 } from "./level3";
import type { DecodeRequest, DecodeResponse } from "./protocol";
import { levelColors, renderSweep, type Sweep } from "./sweep";

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

async function toImage(sweep: Sweep, scaleId: DecodeRequest["scale"], maxPx: number) {
  const scale = DECODED_SCALES[scaleId];
  const colors = levelColors(sweep.table, (v) => scaleColor(scale, v));
  // Range-folded gates in the scale's flag colour.
  const rf = scale.special?.[0];
  if (rf) {
    const n = parseInt(rf.color.slice(1), 16);
    for (const sp of sweep.special) {
      colors.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], sp.level * 4);
    }
  }
  const img = renderSweep(sweep, colors, maxPx);
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext("2d")!.putImageData(new ImageData(img.rgba as ImageDataArray, img.width, img.height), 0, 0);
  return { image: await canvas.convertToBlob({ type: "image/png" }), bounds: img.bounds };
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const req = e.data;
  try {
    let sweep: Sweep | null;
    let cuts: number[] = [];
    if (req.kind === "l3") {
      sweep = parseLevel3(await fetchBytes(req.url));
    } else {
      const r = parseLevel2(await volume(req.url), req.moment, req.angle, { site: req.site });
      sweep = r.sweep;
      cuts = r.cuts.map((c) => c.angle);
      if (!sweep) {
        self.postMessage({ id: req.id, ok: false, error: "No such cut in this volume", empty: true, cuts } satisfies DecodeResponse);
        return;
      }
    }
    const { image, bounds } = await toImage(sweep, req.scale, req.maxPx);
    const msg: DecodeResponse = { id: req.id, ok: true, image, bounds, sweep, cuts };
    self.postMessage(msg, [sweep.data.buffer, sweep.azStart.buffer, sweep.azWidth.buffer, sweep.table.buffer] as Transferable[]);
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies DecodeResponse);
  }
};
