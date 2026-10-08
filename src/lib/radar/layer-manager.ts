/**
 * RadarLayerManager — the frame pool behind fluid NEXRAD loops.
 *
 * Strategy (the "pre-buffered layer stack" used by most pro radar viewers):
 *  1. Every frame in the loop gets its own raster source + layer, added with
 *     `raster-opacity: 0`. MapLibre still requests and uploads tiles for
 *     zero-opacity layers but skips drawing them, so the whole loop is
 *     prefetched into GPU textures while costing nothing per render.
 *  2. Animation is then a pure paint-property flip (old → 0, new → α), with
 *     an optional short opacity transition for a cross-dissolve. No network
 *     and no texture upload happens on the hot path → no stutter.
 *  3. Frames are diffed by immutable id, so a new volume scan adds exactly one
 *     source and evicts the oldest; GPU textures for evicted frames are freed
 *     immediately (bounded memory regardless of session length).
 *  4. Per-frame readiness is tracked from `sourcedata`/`idle` events so the
 *     player can wait on (never display) a frame whose tiles aren't in yet.
 *  5. Below MapLibre, a service worker keeps timestamped tile responses in a
 *     bounded cache-first store (see /public/sw.js), so re-buffering after a
 *     pan/zoom is served from disk instead of the network.
 */
import type { RadarFrame } from "./frames";

/** The subset of maplibregl.Map we depend on (keeps this unit-testable). */
export interface RadarMap {
  addSource(id: string, source: {
    type: "raster";
    tiles: string[];
    tileSize: number;
    maxzoom: number;
    attribution?: string;
  }): unknown;
  removeSource(id: string): unknown;
  getSource(id: string): unknown;
  addLayer(layer: {
    id: string;
    type: "raster";
    source: string;
    paint: Record<string, unknown>;
  }, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  getLayer(id: string): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
  isSourceLoaded(id: string): boolean;
  on(type: string, listener: (e: unknown) => void): unknown;
  off(type: string, listener: (e: unknown) => void): unknown;
}

export interface BufferStatus {
  /** Readiness per frame, aligned with the frames passed to `sync`. */
  ready: boolean[];
  loaded: number;
  total: number;
}

export interface LayerManagerOptions {
  /** Insert radar layers beneath this layer (e.g. warnings or labels). */
  beforeId?: () => string | undefined;
  opacity?: number;
  crossfadeMs?: number;
  /** Nearest-neighbour resampling for crisp gates (velocity, CC, ZDR). */
  crisp?: boolean;
  attribution?: string;
  onStatus?: (status: BufferStatus) => void;
  /** Injected for tests; defaults to requestAnimationFrame. */
  schedule?: (fn: () => void) => void;
}

const SOURCE_PREFIX = "radar-src-";
const LAYER_PREFIX = "radar-lyr-";

export class RadarLayerManager {
  private frames: RadarFrame[] = [];
  private visibleId: string | null = null;
  private opacity: number;
  private crossfadeMs: number;
  private crisp: boolean;
  private scheduled = false;
  private lastStatusKey = "";
  private destroyed = false;

  constructor(
    private readonly map: RadarMap,
    private readonly opts: LayerManagerOptions = {},
  ) {
    this.opacity = opts.opacity ?? 0.85;
    this.crossfadeMs = opts.crossfadeMs ?? 0;
    this.crisp = opts.crisp ?? false;
    map.on("sourcedata", this.onData);
    map.on("idle", this.onData);
    map.on("error", this.onError);
  }

  get frameList(): readonly RadarFrame[] {
    return this.frames;
  }

  /** Reconcile the layer stack with `next` (ordered oldest → newest). */
  sync(next: readonly RadarFrame[]) {
    if (this.destroyed) return;
    const nextIds = new Set(next.map((f) => f.id));
    for (const f of this.frames) if (!nextIds.has(f.id)) this.removeFrame(f.id);

    // Add newest first so the most recent scan's tiles are requested first.
    const toAdd = next.filter((f) => !this.map.getSource(SOURCE_PREFIX + f.id));
    for (let i = toAdd.length - 1; i >= 0; i--) this.addFrame(toAdd[i]!);

    this.frames = [...next];
    if (this.visibleId && !nextIds.has(this.visibleId)) this.visibleId = null;
    this.scheduleStatus();
  }

  /** Make frame `index` the only visible frame. */
  show(index: number) {
    const frame = this.frames[index];
    if (!frame || frame.id === this.visibleId || this.destroyed) return;
    const prev = this.visibleId;
    this.setLayerOpacity(frame.id, this.opacity);
    if (prev) this.setLayerOpacity(prev, 0);
    this.visibleId = frame.id;
  }

  isReady(index: number): boolean {
    const f = this.frames[index];
    return !!f && this.sourceLoaded(f.id);
  }

  setOpacity(opacity: number) {
    this.opacity = opacity;
    if (this.visibleId) this.setLayerOpacity(this.visibleId, opacity);
  }

  /** Cross-dissolve duration; the player shortens it at high speeds. */
  setCrossfade(ms: number) {
    if (ms === this.crossfadeMs) return;
    this.crossfadeMs = ms;
    for (const f of this.frames) {
      this.safePaint(LAYER_PREFIX + f.id, "raster-opacity-transition", { duration: ms, delay: 0 });
    }
  }

  setCrisp(crisp: boolean) {
    if (crisp === this.crisp) return;
    this.crisp = crisp;
    for (const f of this.frames) this.safePaint(LAYER_PREFIX + f.id, "raster-resampling", crisp ? "nearest" : "linear");
  }

  /** Remove every radar layer/source and detach listeners. */
  destroy() {
    if (this.destroyed) return;
    for (const f of this.frames) this.removeFrame(f.id);
    this.frames = [];
    this.visibleId = null;
    this.map.off("sourcedata", this.onData);
    this.map.off("idle", this.onData);
    this.map.off("error", this.onError);
    this.destroyed = true;
  }

  private addFrame(f: RadarFrame) {
    const sourceId = SOURCE_PREFIX + f.id;
    this.map.addSource(sourceId, {
      type: "raster",
      tiles: [f.tileUrl],
      tileSize: 256,
      maxzoom: f.maxzoom,
      attribution: this.opts.attribution,
    });
    const beforeId = this.opts.beforeId?.();
    this.map.addLayer(
      {
        id: LAYER_PREFIX + f.id,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": 0,
          "raster-opacity-transition": { duration: this.crossfadeMs, delay: 0 },
          // Tiles must appear instantly when a frame becomes visible.
          "raster-fade-duration": 0,
          "raster-resampling": this.crisp ? "nearest" : "linear",
        },
      },
      beforeId && this.map.getLayer(beforeId) ? beforeId : undefined,
    );
  }

  private removeFrame(id: string) {
    const layerId = LAYER_PREFIX + id;
    const sourceId = SOURCE_PREFIX + id;
    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
  }

  private setLayerOpacity(id: string, value: number) {
    this.safePaint(LAYER_PREFIX + id, "raster-opacity", value);
  }

  private safePaint(layerId: string, prop: string, value: unknown) {
    if (this.map.getLayer(layerId)) this.map.setPaintProperty(layerId, prop, value);
  }

  private sourceLoaded(id: string) {
    const sourceId = SOURCE_PREFIX + id;
    if (!this.map.getSource(sourceId)) return false;
    try {
      return this.map.isSourceLoaded(sourceId);
    } catch {
      return false;
    }
  }

  private readonly onData = () => this.scheduleStatus();

  /** Tile 404s (e.g. outside coverage) are expected; don't spam the console. */
  private readonly onError = (e: unknown) => {
    const sourceId = (e as { sourceId?: string } | undefined)?.sourceId;
    if (sourceId?.startsWith(SOURCE_PREFIX)) this.scheduleStatus();
    else console.error((e as { error?: unknown })?.error ?? e);
  };

  private scheduleStatus() {
    if (this.scheduled || this.destroyed) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      if (this.destroyed) return;
      const ready = this.frames.map((f) => this.sourceLoaded(f.id));
      const key = ready.map((r) => (r ? 1 : 0)).join("") + this.frames.map((f) => f.id).join("|");
      if (key === this.lastStatusKey) return;
      this.lastStatusKey = key;
      this.opts.onStatus?.({ ready, loaded: ready.filter(Boolean).length, total: ready.length });
    };
    (this.opts.schedule ?? ((fn) => requestAnimationFrame(fn)))(run);
  }
}
