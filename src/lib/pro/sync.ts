/**
 * The Professional-mode sync bus: one camera, one loop clock and one cursor
 * shared by every pane.
 *
 * It's a vanilla zustand store on purpose. Panes subscribe to it outside
 * React and apply changes straight to their MapLibre map (jumpTo, a raster
 * paint flip, a crosshair transform), so panning a 3×3 layout or stepping the
 * loop never re-renders the React tree. Only small widgets that display these
 * values (the transport, the readout) read them through `useProSync`.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

export interface Camera {
  lng: number;
  lat: number;
  zoom: number;
  /** The pane that moved it (that pane doesn't echo it back); "workspace" for programmatic moves. */
  source: string;
}

export interface Cursor {
  lng: number;
  lat: number;
  source: string;
}

export interface SyncState {
  camera: Camera;
  /** Scan times (epoch ms) of the lead pane's loop: the clock steps through these. */
  timeline: number[];
  /** Which timeline frames the lead pane has buffered. */
  ready: boolean[];
  index: number;
  playing: boolean;
  cursor: Cursor | null;
}

export const DEFAULT_CAMERA: Camera = { lng: -97.44, lat: 35.22, zoom: 6.2, source: "workspace" };

export function createProSync(camera: Camera = DEFAULT_CAMERA) {
  return createStore<SyncState>()(() => ({ camera, timeline: [], ready: [], index: 0, playing: true, cursor: null }));
}

export type ProSync = ReturnType<typeof createProSync>;

/** The loop clock's time: the lead pane's frame at `index` (or now, before any frames arrive). */
export function syncTime(s: Pick<SyncState, "timeline" | "index">): number {
  return s.timeline[Math.min(s.index, s.timeline.length - 1)] ?? Date.now();
}

/**
 * The frame to show for time `t`: the newest frame at or before it, or the
 * oldest when `t` is earlier than all of them. -1 when there are none.
 * Different products scan at different times; this keeps every pane on the
 * same moment.
 */
export function frameAt(times: readonly number[], t: number): number {
  if (!times.length) return -1;
  let best = 0;
  for (let i = 0; i < times.length; i++) if (times[i]! <= t) best = i;
  return best;
}

/** Same-moment check for two camera states (avoids echo loops and redundant jumps). */
export function sameCamera(a: Pick<Camera, "lng" | "lat" | "zoom">, b: Pick<Camera, "lng" | "lat" | "zoom">): boolean {
  return Math.abs(a.lng - b.lng) < 1e-7 && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.zoom - b.zoom) < 1e-5;
}

/** React access for the few widgets that display sync values. */
export function useProSync<T>(store: ProSync, selector: (s: SyncState) => T): T {
  return useStore(store, selector);
}
