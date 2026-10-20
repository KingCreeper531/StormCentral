/**
 * Professional mode across windows: the workspace and the panels popped out
 * of it (onto other monitors) stay one workspace over a BroadcastChannel.
 * Same origin only, so it joins the desktop app's windows, or browser windows
 * of the site, and nothing else.
 *
 * What crosses:
 * - the sync bus: camera and cursor both ways (each tagged with the pane that
 *   moved it, so nothing echoes), the loop index and play state both ways, and
 *   the timeline from the workspace, whose time-basis panel sets it;
 * - the Pro store's shared settings and tool state (panes, site, tool, storm
 *   vector, TOA points, WarnGen draft);
 * - the analysis tools' points (sounding, cross-section, the inspected
 *   warning), which live in the workspace's React state;
 * - presence: each pop-out says it's open every couple of seconds, so the
 *   workspace knows which panels to leave out, and gets them back when a
 *   pop-out closes or stops answering.
 */
import type { LatLon } from "../geo";
import type { ProSync, SyncState } from "./sync";

export const LINK_CHANNEL = "stormcentral-pro";
/** A pop-out that hasn't said it's open for this long is gone (closed, crashed, put to sleep). */
export const POPOUT_TIMEOUT_MS = 6_000;
const HEARTBEAT_MS = 2_000;

/** A pop-out: a pane by id ("p2"), or the analysis panel. */
export type PopoutKey = string;
export const PANEL_KEY = "panel";

export interface ToolPoints {
  soundingAt: LatLon;
  xsect: { a: LatLon; b: LatLon | null } | null;
  selectedAlert: string | null;
}

type SyncPart = Partial<Pick<SyncState, "camera" | "cursor" | "index" | "playing" | "timeline">>;

export type LinkMessage =
  | { t: "sync"; from: string; s: SyncPart }
  | { t: "store"; from: string; s: Record<string, unknown> }
  | { t: "tools"; from: string; s: Partial<ToolPoints> }
  | { t: "hello"; from: string }
  | { t: "here"; from: string; key: PopoutKey }
  | { t: "bye"; from: string; key: PopoutKey }
  | { t: "recall"; from: string; key: PopoutKey };

/** A store the link keeps in step (the Pro store): its shared fields are sent and applied as they change. */
export interface LinkedStore {
  getState(): Record<string, unknown>;
  setState(patch: Record<string, unknown>): void;
  subscribe(listener: (state: Record<string, unknown>, prev: Record<string, unknown>) => void): () => void;
  /** The fields that are the same in every window. */
  fields: readonly string[];
}

export interface LinkOptions {
  /** The workspace runs the loop clock and keeps track of pop-outs; a pop-out shows one of its panels. */
  role: "workspace" | "popout";
  /** For a pop-out: what it shows. */
  key?: PopoutKey;
  sync: ProSync;
  store: LinkedStore;
  tools: { get(): ToolPoints; set(patch: Partial<ToolPoints>): void };
  /** Workspace: the pop-outs open now. */
  onPopouts?: (keys: ReadonlySet<PopoutKey>) => void;
  /** Pop-out: the workspace wants this panel back. */
  onRecall?: () => void;
  /** For tests: a channel factory (BroadcastChannel by default). */
  channel?: (name: string) => Pick<BroadcastChannel, "postMessage" | "close"> & { onmessage: ((e: MessageEvent) => void) | null };
  now?: () => number;
}

export interface ProLink {
  /** The analysis tools' points changed here: tell the other windows. */
  sendTools(patch: Partial<ToolPoints>): void;
  /** Workspace: a pop-out is opening; its panel counts as moved unless it never says it's there. */
  expect(key: PopoutKey): void;
  /** Workspace: ask a pop-out to close (its panel comes back). */
  recall(key: PopoutKey): void;
  close(): void;
}

const SYNC_BOTH = ["camera", "cursor", "index", "playing"] as const;

export function connectProLink(o: LinkOptions): ProLink {
  const id = Math.random().toString(36).slice(2);
  const now = o.now ?? (() => Date.now());
  const ch = (o.channel ?? ((name) => new BroadcastChannel(name)))(LINK_CHANNEL);
  /** Applying what another window sent: don't send it back. */
  let applying = false;
  const seen = new Map<PopoutKey, number>();
  let popouts = "";

  const post = (m: LinkMessage) => {
    try {
      ch.postMessage(m);
    } catch {
      // A closed channel (window going away): nothing to tell.
    }
  };
  const apply = (fn: () => void) => {
    applying = true;
    try {
      fn();
    } finally {
      applying = false;
    }
  };

  const syncFields = o.role === "workspace" ? [...SYNC_BOTH, "timeline" as const] : SYNC_BOTH;
  const snapshotSync = (): SyncPart => {
    const s = o.sync.getState();
    const out: Record<string, unknown> = {};
    for (const k of syncFields) out[k] = s[k];
    return out as SyncPart;
  };
  const snapshotStore = () => {
    const s = o.store.getState();
    return Object.fromEntries(o.store.fields.map((k) => [k, s[k]]));
  };

  const unsubSync = o.sync.subscribe((s, prev) => {
    if (applying) return;
    const part: Record<string, unknown> = {};
    for (const k of syncFields) if (s[k] !== prev[k]) part[k] = s[k];
    if (Object.keys(part).length) post({ t: "sync", from: id, s: part as SyncPart });
  });
  const unsubStore = o.store.subscribe((s, prev) => {
    if (applying) return;
    const part: Record<string, unknown> = {};
    for (const k of o.store.fields) if (s[k] !== prev[k]) part[k] = s[k];
    if (Object.keys(part).length) post({ t: "store", from: id, s: part });
  });

  const reportPopouts = () => {
    const cutoff = now() - POPOUT_TIMEOUT_MS;
    for (const [k, at] of seen) if (at < cutoff) seen.delete(k);
    const key = [...seen.keys()].sort().join(",");
    if (key === popouts) return;
    popouts = key;
    o.onPopouts?.(new Set(seen.keys()));
  };

  ch.onmessage = (e: MessageEvent) => {
    const m = e.data as LinkMessage;
    if (!m || typeof m !== "object" || m.from === id) return;
    switch (m.t) {
      case "sync": {
        // Only the workspace sets the timeline.
        const { timeline, ...rest } = m.s;
        apply(() => o.sync.setState(o.role === "popout" && timeline ? { ...rest, timeline } : rest));
        break;
      }
      case "store":
        apply(() => o.store.setState(Object.fromEntries(Object.entries(m.s).filter(([k]) => o.store.fields.includes(k)))));
        break;
      case "tools":
        apply(() => o.tools.set(m.s));
        break;
      case "hello":
        // A window just opened: the workspace brings it up to date.
        if (o.role === "workspace") {
          post({ t: "sync", from: id, s: snapshotSync() });
          post({ t: "store", from: id, s: snapshotStore() });
          post({ t: "tools", from: id, s: o.tools.get() });
        }
        break;
      case "here":
        if (o.role === "workspace") {
          seen.set(m.key, now());
          reportPopouts();
        }
        break;
      case "bye":
        if (o.role === "workspace") {
          seen.delete(m.key);
          reportPopouts();
        }
        break;
      case "recall":
        if (o.role === "popout" && m.key === o.key) o.onRecall?.();
        break;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  if (o.role === "popout" && o.key) {
    const key = o.key;
    post({ t: "hello", from: id });
    post({ t: "here", from: id, key });
    timer = setInterval(() => post({ t: "here", from: id, key }), HEARTBEAT_MS);
  } else {
    timer = setInterval(reportPopouts, HEARTBEAT_MS);
  }

  return {
    sendTools(patch) {
      if (!applying) post({ t: "tools", from: id, s: patch });
    },
    expect(key) {
      seen.set(key, now());
      reportPopouts();
    },
    recall(key) {
      post({ t: "recall", from: id, key });
      seen.delete(key);
      reportPopouts();
    },
    close() {
      if (timer) clearInterval(timer);
      if (o.role === "popout" && o.key) post({ t: "bye", from: id, key: o.key });
      unsubSync();
      unsubStore();
      ch.onmessage = null;
      ch.close();
    },
  };
}

/** The pop-out's address: a chromeless page showing one panel. */
export const popoutUrl = (key: PopoutKey) => `/pro-window?view=${encodeURIComponent(key)}`;

/** Open (or bring forward) a pop-out window. The desktop app places it on another monitor. */
export function openPopout(key: PopoutKey): void {
  window.open(popoutUrl(key), `stormcentral-pro-${key}`, "popup,width=960,height=720");
}
