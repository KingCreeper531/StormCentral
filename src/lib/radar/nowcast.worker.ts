/// <reference lib="webworker" />
/**
 * Future radar off the main thread: draws two recent scans of the radar the
 * map shows onto a Web Mercator grid over the view (the same CORS-open tiles,
 * or one WMS image), measures how the echoes moved, and renders the frames
 * 10 … 60 minutes ahead as PNGs (lib/radar/nowcast.ts has the method).
 */
import {
  advectFrames,
  echoIntensity,
  leadFade,
  motionFactor,
  motionField,
  NOWCAST_STEP_MIN,
  tileUrl,
  tileZoom,
  tilesFor,
  wmsUrl,
  type Grid,
  type NowcastJob,
  type NowcastRequest,
  type NowcastResponse,
  type NowcastSource,
} from "./nowcast";

declare const self: DedicatedWorkerGlobalScope;

/** Only the newest job runs; a new one (or a cancel) aborts the rest. */
let current = 0;
const controllers = new Map<number, AbortController>();

async function bitmap(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

/** A scan drawn onto the grid (nearest-pixel, so its palette colours stay exact), or null when it didn't load. */
async function draw(src: NowcastSource, g: Grid, signal: AbortSignal): Promise<ImageData | null> {
  const canvas = new OffscreenCanvas(g.width, g.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  if (src.template.includes("{bbox-epsg-3857}")) {
    const bmp = await bitmap(wmsUrl(src.template, g), signal);
    if (!bmp) return null;
    ctx.drawImage(bmp, 0, 0, g.width, g.height);
    bmp.close();
  } else {
    const z = tileZoom(g, src.minzoom, src.maxzoom, src.tileSize);
    const cover = tilesFor(g, z, src.tileSize);
    const mosaic = new OffscreenCanvas(Math.max(1, Math.ceil(cover.width)), Math.max(1, Math.ceil(cover.height)));
    const mctx = mosaic.getContext("2d");
    if (!mctx) return null;
    mctx.imageSmoothingEnabled = false;
    const bmps = await Promise.all(cover.tiles.map((t) => bitmap(tileUrl(src.template, t), signal)));
    let drawn = 0;
    bmps.forEach((bmp, i) => {
      if (!bmp) return;
      const t = cover.tiles[i]!;
      mctx.drawImage(bmp, t.px, t.py, src.tileSize, src.tileSize);
      bmp.close();
      drawn++;
    });
    // Most of the view missing would read as storms dying: better no future at all.
    if (drawn < cover.tiles.length * 0.75) return null;
    ctx.drawImage(mosaic, 0, 0, cover.width, cover.height, 0, 0, g.width, g.height);
  }
  return ctx.getImageData(0, 0, g.width, g.height);
}

async function run(job: NowcastJob, signal: AbortSignal): Promise<NowcastResponse> {
  const g = job.grid;
  const [older, newer] = await Promise.all([draw(job.older, g, signal), draw(job.newer, g, signal)]);
  if (!older || !newer) return { id: job.id, ok: false, skipped: true };
  const motion = motionField(echoIntensity(older.data, g.width, g.height), echoIntensity(newer.data, g.width, g.height), g.width, g.height, motionFactor(g));
  if (!motion) return { id: job.id, ok: false, skipped: true };
  const canvas = new OffscreenCanvas(g.width, g.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { id: job.id, ok: false, skipped: true };
  const frames: { lead: number; image: Blob }[] = [];
  const wanted = new Set(job.leads);
  const steps = Math.round(Math.max(...job.leads) / NOWCAST_STEP_MIN);
  let step = 0;
  for (const pixels of advectFrames(newer.data, g.width, g.height, motion, steps, NOWCAST_STEP_MIN / job.gapMin, (s) => leadFade(s * NOWCAST_STEP_MIN))) {
    if (signal.aborted || job.id !== current) throw new DOMException("Superseded", "AbortError");
    const lead = ++step * NOWCAST_STEP_MIN;
    if (!wanted.has(lead)) continue;
    ctx.putImageData(new ImageData(pixels, g.width, g.height), 0, 0);
    frames.push({ lead, image: await canvas.convertToBlob({ type: "image/png" }) });
  }
  return { id: job.id, ok: true, frames };
}

self.onmessage = (e: MessageEvent<NowcastRequest>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    controllers.get(msg.id)?.abort();
    controllers.delete(msg.id);
    return;
  }
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  current = msg.id;
  const ctl = new AbortController();
  controllers.set(msg.id, ctl);
  run(msg, ctl.signal).then(
    (res) => {
      controllers.delete(msg.id);
      if (msg.id === current) self.postMessage(res);
    },
    (err: unknown) => {
      controllers.delete(msg.id);
      if (ctl.signal.aborted || msg.id !== current) return;
      self.postMessage({ id: msg.id, ok: false, skipped: false, error: err instanceof Error ? err.message : String(err) } satisfies NowcastResponse);
    },
  );
};
