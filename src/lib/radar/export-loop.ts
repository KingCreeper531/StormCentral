/**
 * Radar loop export: step the live map through every frame of the loop, grab
 * each painted frame with a caption bar, and encode an animated GIF (gifenc)
 * or a video (MediaRecorder). Framework-agnostic: the caller passes a getter
 * for the loop's current state, an AbortSignal and a progress callback.
 *
 * The map is created without `preserveDrawingBuffer`, so its WebGL canvas can
 * only be read inside MapLibre's `render` event, in the same task that painted
 * it. Everything else here (size math, delays, palette, file names) is pure
 * and unit-tested.
 */
import type { Map as MlMap } from "maplibre-gl";
import type { RadarLoop } from "@/hooks/use-radar-loop";
import { isNativeApp } from "@/lib/platform";
import { clockIn } from "@/lib/weather/view";
import type { RadarFrame } from "./frames";

// ── Public types ────────────────────────────────────────────────────────────

export type ExportFormat = "gif" | "video";

/** The parts of the loop the export drives. */
export type ExportLoopState = Pick<RadarLoop, "frames" | "index" | "playing" | "ready" | "crossfadeMs" | "setIndex" | "play" | "pause">;

export interface ExportProgress {
  phase: "buffering" | "capturing" | "encoding";
  done: number;
  total: number;
}

export interface LoopExport {
  blob: Blob;
  /** Base type without codec parameters: `image/gif`, `video/mp4` or `video/webm`. */
  mimeType: string;
  filename: string;
  width: number;
  height: number;
  frames: number;
}

export interface ExportLoopOptions {
  map: MlMap;
  /** Returns the loop as it is now; it changes while the export steps through frames. */
  getLoop: () => ExportLoopState;
  /** Video falls back to GIF where MediaRecorder or canvas capture is missing. */
  format: ExportFormat;
  /** Requested output width in px (never more than the map canvas provides). */
  width: number;
  /** e.g. "NEXRAD mosaic, reflectivity". */
  title: string;
  /** e.g. the location name. */
  subtitle?: string;
  /** IANA zone the caption times read in (the selected location's). */
  timeZone?: string;
  /** Loop speed multiplier (1 = normal); sets the frame delay. */
  speed?: number;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  /** How long to wait for unbuffered frames before leaving them out (ms). */
  bufferTimeoutMs?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const EXPORT_WIDTHS = [480, 720] as const;
export type ExportWidth = (typeof EXPORT_WIDTHS)[number];

export const EXPORT_CREDIT = "StormCentral · NEXRAD via Iowa Environmental Mesonet";

/** MediaRecorder types in order of preference (MP4 plays and shares most widely). */
export const VIDEO_MIME_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"] as const;

/** Per-frame delay at 1× and the hold on the newest frame. */
export const EXPORT_FRAME_MS = 400;
export const EXPORT_LAST_FRAME_MS = 1500;

/**
 * Output aspect (height / width) bounds. The map canvas aspect is kept inside
 * these; beyond them (ultra-wide desktop windows, very tall phones) the source
 * is centre-cropped so the file stays a sensible shape (2:1 to 9:16).
 */
export const MIN_ASPECT = 1 / 2;
export const MAX_ASPECT = 16 / 9;

const DEFAULT_BUFFER_TIMEOUT_MS = 20_000;

// ── Pure helpers ────────────────────────────────────────────────────────────

export interface OutputSize {
  width: number;
  height: number;
  /** Source rectangle in map-canvas pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const evenRound = (n: number) => Math.max(2, 2 * Math.round(n / 2));
const evenFloor = (n: number) => Math.max(2, 2 * Math.floor(n / 2));

/**
 * Output size for a map canvas of `srcWidth × srcHeight` device pixels:
 * `targetWidth` wide (or the source width, if smaller: no upscaling), height
 * from the canvas aspect, both even (video encoders need even dimensions).
 */
export function outputSize(srcWidth: number, srcHeight: number, targetWidth: number): OutputSize {
  const w0 = Math.max(1, Math.floor(srcWidth));
  const h0 = Math.max(1, Math.floor(srcHeight));
  let sw = w0;
  let sh = h0;
  const aspect = h0 / w0;
  if (aspect > MAX_ASPECT) sh = Math.round(w0 * MAX_ASPECT);
  else if (aspect < MIN_ASPECT) sw = Math.round(h0 / MIN_ASPECT);
  const width = Math.min(evenFloor(targetWidth), evenFloor(sw));
  const height = evenRound((width * sh) / sw);
  return { width, height, sx: Math.floor((w0 - sw) / 2), sy: Math.floor((h0 - sh) / 2), sw, sh };
}

const round10 = (ms: number) => Math.round(ms / 10) * 10;

/**
 * Per-frame delays (ms) for `count` frames: ~400 ms at 1× (scaled by the loop
 * speed, 100–1000 ms), and the newest frame held at least 1.5 s. Multiples of
 * 10 ms, since GIF stores delays in hundredths of a second.
 */
export function exportFrameDelays(count: number, speed = 1): number[] {
  if (count <= 0) return [];
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const base = round10(Math.min(1000, Math.max(100, EXPORT_FRAME_MS / s)));
  const last = round10(Math.max(EXPORT_LAST_FRAME_MS, base * 2));
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? last : base));
}

/** The first type in `VIDEO_MIME_TYPES` the recorder supports, or null. */
export function pickVideoMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of VIDEO_MIME_TYPES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Some engines throw on unknown codec strings; treat as unsupported.
    }
  }
  return null;
}

/** `video/mp4;codecs=avc1` → `video/mp4`. */
export function baseMimeType(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

export function extensionFor(mime: string): string {
  const base = baseMimeType(mime);
  if (base === "image/gif") return "gif";
  if (base === "video/mp4") return "mp4";
  if (base === "video/x-matroska") return "mkv";
  return "webm";
}

function dateParts(at: Date, timeZone: string | undefined) {
  const opts = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", opts); // unknown zone name: device clock
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  return p;
}

/**
 * `stormcentral-radar-2026-10-07-1912.gif`: the newest frame's local time in
 * `timeZone` (the device's when omitted).
 */
export function exportFilename(time: number | Date, extension: string, timeZone?: string): string {
  const p = dateParts(time instanceof Date ? time : new Date(time), timeZone);
  return `stormcentral-radar-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.${extension}`;
}

/** Overall 0–1 progress: buffering 0–5 %, capture 5–60 %, encoding 60–100 %. */
export function progressFraction(p: ExportProgress): number {
  const f = p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
  if (p.phase === "buffering") return 0.05 * f;
  if (p.phase === "capturing") return 0.05 + 0.55 * f;
  return 0.6 + 0.4 * f;
}

/** `text` shortened with an ellipsis to fit `maxWidth` under `measure` ("" if nothing fits). */
export function truncateToWidth(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (maxWidth <= 0) return "";
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(`${text.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : "";
}

/** Up to `count` evenly spaced indices into `length` items, always including the first and last. */
export function sampleIndices(length: number, count: number): number[] {
  if (length <= 0 || count <= 0) return [];
  if (count === 1) return [length - 1];
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(Math.round((k * (length - 1)) / (count - 1)));
  return [...out];
}

/** "820 KB", "3.4 MB". */
export function formatBytes(n: number): string {
  if (n < 1000) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`;
}

export type Rgb = number[];
export type Quantizer = (rgba: Uint8ClampedArray, maxColors: number) => Rgb[];

/** Pixels whose channels spread at least this far apart (max − min) count as "data" colour: radar, warnings. */
export const CHROMA_SPLIT = 48;
/** Palette entries reserved for data colours; the dark basemap and caption share the rest. */
export const DATA_COLORS = 168;

/**
 * One global 256-colour GIF palette from a few sample frames. A single
 * quantisation would spend most entries on the dark basemap, which covers far
 * more pixels than the echoes, and band the radar scale. So saturated pixels
 * are quantised separately into their own share of the palette, the neutral
 * remainder fills what's left, and pure black and white are always present
 * for the caption text.
 */
export function buildPalette(samples: readonly Uint8ClampedArray[], quantize: Quantizer, maxPixels = 400_000): Rgb[] {
  let total = 0;
  for (const s of samples) total += Math.floor(s.length / 4);
  const stride = Math.max(1, Math.ceil(total / maxPixels));
  const cap = (Math.ceil(total / stride) + samples.length) * 4;
  const vivid = new Uint8ClampedArray(cap);
  const neutral = new Uint8ClampedArray(cap);
  let nv = 0;
  let nn = 0;
  for (const s of samples) {
    for (let p = 0; p + 3 < s.length; p += 4 * stride) {
      const r = s[p]!;
      const g = s[p + 1]!;
      const b = s[p + 2]!;
      const isVivid = Math.max(r, g, b) - Math.min(r, g, b) >= CHROMA_SPLIT;
      const dst = isVivid ? vivid : neutral;
      const o = isVivid ? nv : nn;
      dst[o] = r;
      dst[o + 1] = g;
      dst[o + 2] = b;
      dst[o + 3] = 255;
      if (isVivid) nv += 4;
      else nn += 4;
    }
  }
  const fixed: Rgb[] = [
    [0, 0, 0],
    [255, 255, 255],
  ];
  const budget = 256 - fixed.length;
  const vividColors = nv ? quantize(vivid.subarray(0, nv), nn ? DATA_COLORS : budget).slice(0, budget) : [];
  const room = budget - vividColors.length;
  const neutralColors = nn && room > 0 ? quantize(neutral.subarray(0, nn), room).slice(0, room) : [];
  return [...fixed, ...neutralColors, ...vividColors];
}

// ── Environment checks ──────────────────────────────────────────────────────

/** The MediaRecorder type this browser will record canvas video in, or null (GIF only). */
export function videoMimeType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined") return null;
  if (typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  return pickVideoMimeType((t) => MediaRecorder.isTypeSupported(t));
}

// ── Async plumbing ──────────────────────────────────────────────────────────

const abortError = (signal?: AbortSignal) => signal?.reason ?? new DOMException("Export cancelled", "AbortError");

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "AbortError" : (err as { name?: string } | null)?.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolves true when the map fires `type` (running `handler` synchronously
 * inside the event, where the WebGL drawing buffer is still intact), false
 * after `timeoutMs`; rejects on abort or if the handler throws.
 */
function onMapEvent(map: MlMap, type: "idle" | "render", timeoutMs: number, signal?: AbortSignal, handler?: () => void): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const cleanup = () => {
      clearTimeout(timer);
      map.off(type, listener);
      signal?.removeEventListener("abort", onAbort);
    };
    const listener = () => {
      cleanup();
      try {
        handler?.();
        resolve(true);
      } catch (err) {
        reject(err);
      }
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    map.on(type, listener);
    signal?.addEventListener("abort", onAbort, { once: true });
    map.triggerRepaint();
  });
}

/** The raster layer showing `frameId`, if the layer manager's naming can be found. */
function frameLayerId(map: MlMap, frameId: string): string | undefined {
  try {
    return map.getLayersOrder().find((id) => id.endsWith(frameId));
  } catch {
    return undefined;
  }
}

/**
 * Wait until frame `frameId` is fully on screen after `setIndex`: React has
 * committed the index and the layer manager has switched the frame's layer on
 * (≤ 1 s), the cross-fade has run out and tiles have settled (`idle`, bounded),
 * and at least the cross-fade duration has passed.
 */
async function settleOnFrame(map: MlMap, frameId: string, crossfadeMs: number, signal?: AbortSignal) {
  const t0 = performance.now();
  const layerId = frameLayerId(map, frameId);
  if (layerId) {
    const shown = () => {
      try {
        return Number(map.getPaintProperty(layerId, "raster-opacity")) > 0;
      } catch {
        return true; // layer removed under us: don't stall
      }
    };
    while (!shown() && performance.now() - t0 < 1000) await sleep(16, signal);
  } else {
    await sleep(80, signal);
  }
  await onMapEvent(map, "idle", crossfadeMs + 1500, signal);
  const left = crossfadeMs + 40 - (performance.now() - t0);
  if (left > 0) await sleep(left, signal);
}

/** Frames (by id) that are buffered, waiting up to `timeoutMs` for the rest. */
async function waitForBuffered(
  getLoop: () => ExportLoopState,
  frames: readonly RadarFrame[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
  emit: (p: ExportProgress) => void,
): Promise<Set<string>> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const loop = getLoop();
    const ready = new Set<string>();
    loop.frames.forEach((f, i) => {
      if (loop.ready[i]) ready.add(f.id);
    });
    const have = frames.filter((f) => ready.has(f.id)).length;
    emit({ phase: "buffering", done: have, total: frames.length });
    if (have === frames.length || performance.now() >= deadline) return ready;
    await sleep(200, signal);
  }
}

function restoreLoop(getLoop: () => ExportLoopState, frameId: string | undefined, playing: boolean) {
  const loop = getLoop();
  if (loop.frames.length) {
    const i = frameId ? loop.frames.findIndex((f) => f.id === frameId) : -1;
    loop.setIndex(i >= 0 ? i : loop.frames.length - 1);
  }
  if (playing) loop.play();
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

// ── Caption ─────────────────────────────────────────────────────────────────

const INK = "#ececed";
const INK_2 = "#a8acb3";
const INK_3 = "#80858d";

interface Caption {
  time: string;
  date: string;
  title: string;
  subtitle?: string;
  /** Loop position 0–1, drawn as a hairline along the top of the bar. */
  position: number;
  fontFamily: string;
}

function dateLabel(time: number, timeZone: string | undefined) {
  const opts = { month: "short", day: "numeric", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(time);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(time);
  }
}

/** Bottom caption bar: time and date, product title, place, and the data credit. */
function drawCaption(ctx: CanvasRenderingContext2D, w: number, h: number, c: Caption) {
  const s = Math.min(2, Math.max(0.75, w / 480));
  const px = (n: number) => Math.round(n * s);
  const barH = px(46);
  const y0 = h - barH;
  const pad = px(12);
  const gap = px(10);
  const inner = w - pad * 2;
  const font = (weight: number, size: number) => `${weight} ${px(size)}px ${c.fontFamily}`;
  const measure = (t: string) => ctx.measureText(t).width;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
  ctx.fillRect(0, y0, w, barH);
  const line = Math.max(2, px(2));
  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.fillRect(0, y0, w, line);
  ctx.fillStyle = "rgba(236, 236, 237, 0.85)";
  ctx.fillRect(0, y0, Math.round(w * Math.min(1, Math.max(0, c.position))), line);
  ctx.textBaseline = "alphabetic";

  // Row 1: time (bold) and date on the left, product title on the right.
  const row1 = y0 + px(21);
  ctx.textAlign = "left";
  ctx.font = font(600, 16);
  ctx.fillStyle = INK;
  const time = truncateToWidth(c.time, inner, measure);
  ctx.fillText(time, pad, row1);
  let x = pad + measure(time) + px(8);
  ctx.font = font(400, 12);
  const dateW = measure(c.date);
  if (x + dateW <= pad + inner) {
    ctx.fillStyle = INK_2;
    ctx.fillText(c.date, x, row1);
    x += dateW;
  }
  ctx.font = font(500, 12);
  const title = truncateToWidth(c.title, pad + inner - x - gap, measure);
  if (title) {
    ctx.textAlign = "right";
    ctx.fillStyle = INK;
    ctx.fillText(title, w - pad, row1);
  }

  // Row 2: place on the left, credit on the right (the credit wins the space).
  const row2 = y0 + px(38);
  ctx.font = font(400, 10);
  const credit = truncateToWidth(EXPORT_CREDIT, inner, measure);
  ctx.textAlign = "right";
  ctx.fillStyle = INK_3;
  ctx.fillText(credit, w - pad, row2);
  const creditW = measure(credit);
  if (c.subtitle) {
    ctx.font = font(400, 12);
    const sub = truncateToWidth(c.subtitle, inner - creditW - gap, measure);
    if (sub) {
      ctx.textAlign = "left";
      ctx.fillStyle = INK_2;
      ctx.fillText(sub, pad, row2);
    }
  }
  ctx.restore();
}

// ── Encoders ────────────────────────────────────────────────────────────────

async function encodeGif(images: readonly ImageData[], delays: readonly number[], signal: AbortSignal | undefined, emit: (p: ExportProgress) => void): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const samples = sampleIndices(images.length, 4).map((i) => images[i]!.data);
  const palette = buildPalette(samples, (rgba, n) => quantize(rgba, n, { format: "rgb565" }));
  const gif = GIFEncoder();
  for (let k = 0; k < images.length; k++) {
    signal?.throwIfAborted();
    emit({ phase: "encoding", done: k, total: images.length });
    const img = images[k]!;
    const index = applyPalette(img.data, palette, "rgb565");
    // The palette goes in once, as the global table; later frames reuse it.
    gif.writeFrame(index, img.width, img.height, { palette: k === 0 ? palette : undefined, delay: delays[k] ?? EXPORT_FRAME_MS, repeat: 0 });
    await nextTask();
  }
  gif.finish();
  emit({ phase: "encoding", done: images.length, total: images.length });
  return new Blob([gif.bytes()], { type: "image/gif" });
}

/**
 * Plays the frames into a MediaRecorder in real time: each frame is pushed
 * with `requestFrame()` and held for its delay, so the container timestamps
 * match the loop. A repeat of the last frame closes the final hold, since a
 * frame's duration is only known when the next one arrives.
 */
async function encodeVideo(
  images: readonly ImageData[],
  delays: readonly number[],
  mime: string,
  signal: AbortSignal | undefined,
  emit: (p: ExportProgress) => void,
): Promise<{ blob: Blob; mimeType: string }> {
  const first = images[0]!;
  const last = images[images.length - 1]!;
  const canvas = document.createElement("canvas");
  canvas.width = first.width;
  canvas.height = first.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the video frames.");
  ctx.putImageData(first, 0, 0);

  let stream = canvas.captureStream(0);
  let track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (typeof track?.requestFrame !== "function") {
    // No manual frame requests: a rate-less stream emits a frame whenever the canvas changes.
    for (const t of stream.getTracks()) t.stop();
    stream = canvas.captureStream();
    track = undefined;
  }
  const push = (img: ImageData) => {
    ctx.putImageData(img, 0, 0);
    track?.requestFrame();
  };

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.round(Math.min(8e6, Math.max(1e6, first.width * first.height * 4))),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("Video recording failed. Try the GIF format."));
  });
  stopped.catch(() => {}); // awaited below; don't report it twice if we bail out first
  const started = new Promise<void>((resolve) => {
    recorder.onstart = () => resolve();
  });

  try {
    recorder.start();
    // Frames requested before the recorder is live are dropped.
    await Promise.race([started, sleep(500)]);
    for (let k = 0; k < images.length; k++) {
      signal?.throwIfAborted();
      emit({ phase: "encoding", done: k, total: images.length });
      push(images[k]!);
      await sleep(delays[k] ?? EXPORT_FRAME_MS, signal);
    }
    push(last);
    await sleep(60, signal);
    recorder.stop();
    await stopped;
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    for (const t of stream.getTracks()) t.stop();
  }
  emit({ phase: "encoding", done: images.length, total: images.length });
  const mimeType = baseMimeType(recorder.mimeType || mime) || baseMimeType(mime);
  return { blob: new Blob(chunks, { type: mimeType }), mimeType };
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Capture the loop from the live map and encode it. Pauses the loop while
 * capturing and restores its frame and play state afterwards (also on cancel
 * or error). Frames that are still loading are waited for (bounded by
 * `bufferTimeoutMs`) and left out if they never arrive, never exported blank.
 */
export async function exportRadarLoop(opts: ExportLoopOptions): Promise<LoopExport> {
  const { map, getLoop, signal } = opts;
  const emit = (p: ExportProgress) => {
    if (!signal?.aborted) opts.onProgress?.(p);
  };
  signal?.throwIfAborted();

  const start = getLoop();
  const frames = start.frames.slice();
  if (!frames.length) throw new Error("There are no radar frames to export yet.");
  const restoreId = frames[start.index]?.id;
  const wasPlaying = start.playing;
  start.pause();

  const captured: { image: ImageData; frame: RadarFrame }[] = [];
  try {
    const ready = await waitForBuffered(getLoop, frames, opts.bufferTimeoutMs ?? DEFAULT_BUFFER_TIMEOUT_MS, signal, emit);
    const todo = frames.filter((f) => ready.has(f.id));
    if (!todo.length) throw new Error("The radar frames haven't loaded yet. Try again once the loop has buffered.");

    const src = map.getCanvas();
    const size = outputSize(src.width, src.height, opts.width);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser can't capture the map.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const fontFamily = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";

    for (let k = 0; k < todo.length; k++) {
      signal?.throwIfAborted();
      emit({ phase: "capturing", done: k, total: todo.length });
      const frame = todo[k]!;
      const loop = getLoop();
      const i = loop.frames.findIndex((f) => f.id === frame.id);
      if (i < 0) continue; // evicted by a newer scan mid-export
      loop.setIndex(i);
      await settleOnFrame(map, frame.id, loop.crossfadeMs, signal);
      const painted = await onMapEvent(map, "render", 2000, signal, () => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(map.getCanvas(), size.sx, size.sy, size.sw, size.sh, 0, 0, size.width, size.height);
      });
      if (!painted) throw new Error("The map stopped drawing. Keep StormCentral on screen while the loop exports.");
      drawCaption(ctx, size.width, size.height, {
        time: `${frame.approximate ? "~" : ""}${clockIn(opts.timeZone, frame.time)}`,
        date: dateLabel(frame.time, opts.timeZone),
        title: opts.title,
        subtitle: opts.subtitle,
        position: (k + 1) / todo.length,
        fontFamily,
      });
      captured.push({ image: ctx.getImageData(0, 0, size.width, size.height), frame });
    }
    emit({ phase: "capturing", done: todo.length, total: todo.length });
  } finally {
    restoreLoop(getLoop, restoreId, wasPlaying);
  }

  if (!captured.length) throw new Error("No frames could be captured.");
  const images = captured.map((c) => c.image);
  const delays = exportFrameDelays(images.length, opts.speed);
  const newest = captured[captured.length - 1]!.frame.time;
  const { width, height } = images[0]!;

  const videoType = opts.format === "video" ? videoMimeType() : null;
  if (videoType) {
    const { blob, mimeType } = await encodeVideo(images, delays, videoType, signal, emit);
    return { blob, mimeType, filename: exportFilename(newest, extensionFor(mimeType), opts.timeZone), width, height, frames: images.length };
  }
  const blob = await encodeGif(images, delays, signal, emit);
  return { blob, mimeType: "image/gif", filename: exportFilename(newest, "gif", opts.timeZone), width, height, frames: images.length };
}

// ── Save and share ──────────────────────────────────────────────────────────

const toFile = (exp: LoopExport) => new File([exp.blob], exp.filename, { type: exp.mimeType });

/** True when the Share action can hand this file to another app. */
export function canShareExport(exp: LoopExport): boolean {
  if (isNativeApp()) return true;
  try {
    return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [toFile(exp)] });
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the exported file."));
    reader.readAsDataURL(blob);
  });
}

/** Android app: write the file to the app cache and open the system share sheet (which offers saving too). */
async function shareNative(exp: LoopExport): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const data = await blobToBase64(exp.blob);
  const { uri } = await Filesystem.writeFile({ path: exp.filename, data, directory: Directory.Cache });
  try {
    await Share.share({ files: [uri], title: "Radar loop", dialogTitle: "Save or share radar loop" });
  } catch (err) {
    if (/cancel/i.test(err instanceof Error ? err.message : String(err))) return; // sheet dismissed
    throw err;
  }
}

/**
 * Save the export. Web and desktop: a download of `url` (an object URL for the
 * blob; one is made and released if omitted). Android app: the share sheet.
 */
export async function saveExport(exp: LoopExport, url?: string): Promise<void> {
  if (isNativeApp()) return shareNative(exp);
  const href = url ?? URL.createObjectURL(exp.blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = exp.filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!url) setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/**
 * Share the export: the Web Share API with a File, or the share sheet in the
 * Android app. Call straight from a click handler (Web Share needs the user
 * gesture). Resolves false if the person dismissed the sheet.
 */
export async function shareExport(exp: LoopExport): Promise<boolean> {
  if (isNativeApp()) {
    await shareNative(exp);
    return true;
  }
  try {
    await navigator.share({ files: [toFile(exp)], title: "Radar loop" });
    return true;
  } catch (err) {
    if (isAbortError(err)) return false;
    throw err;
  }
}
