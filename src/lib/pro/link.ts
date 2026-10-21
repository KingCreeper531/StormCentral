/**
 * Professional mode across windows: the workspace and the panels popped out
 * of it (onto other monitors) stay one workspace over a BroadcastChannel.
 * Same origin only, so it joins the desktop app's windows, or browser windows
 * of the site, and nothing else. Every message carries its workspace's id (a
 * pop-out has it in its address), so two workspaces open at once each keep
 * to their own pop-outs.
 *
 * What crosses:
 * - the sync bus: camera and cursor both ways (each tagged with the pane that
 *   moved it, so nothing echoes), the loop index and play state both ways, and
 *   the timeline from the workspace, whose time-basis panel sets it (or from
 *   the pop-out holding that panel, when the workspace shows none itself);
 * - the Pro store's shared settings and tool state (panes, site, tool, storm
 *   vector, TOA points, WarnGen draft);
 * - the analysis tools' points (sounding, cross-section, the inspected
 *   warning), which live in the workspace's React state;
 * - presence: each pop-out says it's open every couple of seconds, so the
 *   workspace knows which panels to leave out, and gets them back when a
 *   pop-out closes or stops answering. A workspace that (re)opens asks its
 *   pop-outs to say hello, and brings them up to date.
 */
import type { LatLon } from "../geo";
import type { ProSync, SyncState } from "./sync";

export const LINK_CHANNEL = "stormcentral-pro";
/** A pop-out that hasn't said it's open for this long is gone (closed, crashed, put to sleep). */
export const POPOUT_TIMEOUT_MS = 6_000;
/** A hidden pop-out's timers run about once a minute (Chrome throttles them): it gets this long. */
export const HIDDEN_POPOUT_TIMEOUT_MS = 90_000;
const HEARTBEAT_MS = 2_000;

/** A pop-out: a pane by id ("p2"), or the analysis panel. */
export type PopoutKey = string;
export const PANEL_KEY = "panel";

export interface ToolPoints {
  soundingAt: LatLon;
  xsect: { a: LatLon; b: LatLon | null } | null;
  selectedAlert: string | null;
}

type SyncPart = Partial<Pick<SyncState, "camera" | "cursor" | "index" | "playing" | "timeline" | "ready">>;

type Body =
  | { t: "sync"; s: SyncPart }
  | { t: "store"; s: Record<string, unknown> }
  | { t: "tools"; s: Partial<ToolPoints> }
  | { t: "hello" }
  /** The workspace (re)opened: its pop-outs say hello again. */
  | { t: "rollcall" }
  | { t: "here"; key: PopoutKey; hidden?: boolean }
  | { t: "bye"; key: PopoutKey }
  | { t: "recall"; key: PopoutKey }
  /** The pop-out whose panel sets the timeline; null: one of the workspace's own. */
  | { t: "basis"; key: PopoutKey | null };

/** Every message says which window sent it, and which workspace that window belongs to. */
export type LinkMessage = Body & { from: string; ws: string };

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
  /** The workspace's id (a pop-out's comes from its address): messages of other workspaces are ignored. */
  workspace: string;
  /** For a pop-out: what it shows. */
  key?: PopoutKey;
  sync: ProSync;
  store: LinkedStore;
  tools: { get(): ToolPoints; set(patch: Partial<ToolPoints>): void };
  /** Workspace: the pop-outs open now. */
  onPopouts?: (keys: ReadonlySet<PopoutKey>) => void;
  /** Pop-out: the workspace wants this panel back. */
  onRecall?: () => void;
  /** Pop-out: whether its panel sets the loop's timeline now. */
  onBasis?: (basis: boolean) => void;
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
  /** Workspace: the pop-out whose panel sets the timeline (it shows no panel itself), or null. */
  setBasis(key: PopoutKey | null): void;
  close(): void;
}

const SYNC_BOTH = ["camera", "cursor", "index", "playing"] as const;

export function connectProLink(o: LinkOptions): ProLink {
  const id = Math.random().toString(36).slice(2);
  const now = o.now ?? (() => Date.now());
  const ch = (o.channel ?? ((name) => new BroadcastChannel(name)))(LINK_CHANNEL);
  /** Applying what another window sent: don't send it back. */
  let applying = false;
  const seen = new Map<PopoutKey, { at: number; hidden: boolean }>();
  let popouts = "";
  /** Workspace: the pop-out it handed the timeline to. Pop-out: whether that's this one. */
  let basis: PopoutKey | null = null;
  let isBasis = false;

  const post = (m: Body) => {
    try {
      ch.postMessage({ ...m, from: id, ws: o.workspace });
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

  /** The timeline (and its buffer state, for the workspace's clock) goes out from whichever window's panel sets it. */
  const syncFields = (): readonly (keyof SyncPart)[] =>
    o.role === "workspace" ? [...SYNC_BOTH, "timeline"] : isBasis ? [...SYNC_BOTH, "timeline", "ready"] : SYNC_BOTH;
  const snapshotSync = (): SyncPart => {
    const s = o.sync.getState();
    const out: Record<string, unknown> = {};
    for (const k of syncFields()) out[k] = s[k];
    return out as SyncPart;
  };
  const snapshotStore = () => {
    const s = o.store.getState();
    return Object.fromEntries(o.store.fields.map((k) => [k, s[k]]));
  };

  const unsubSync = o.sync.subscribe((s, prev) => {
    if (applying) return;
    const part: Record<string, unknown> = {};
    for (const k of syncFields()) if (s[k] !== prev[k]) part[k] = s[k];
    if (Object.keys(part).length) post({ t: "sync", s: part as SyncPart });
  });
  const unsubStore = o.store.subscribe((s, prev) => {
    if (applying) return;
    const part: Record<string, unknown> = {};
    for (const k of o.store.fields) if (s[k] !== prev[k]) part[k] = s[k];
    if (Object.keys(part).length) post({ t: "store", s: part });
  });

  const reportPopouts = () => {
    const t = now();
    for (const [k, v] of seen) if (v.at < t - (v.hidden ? HIDDEN_POPOUT_TIMEOUT_MS : POPOUT_TIMEOUT_MS)) seen.delete(k);
    const key = [...seen.keys()].sort().join(",");
    if (key === popouts) return;
    popouts = key;
    o.onPopouts?.(new Set(seen.keys()));
  };

  /** Pop-out: "still here", and whether the window is hidden (its heartbeat slows right down then). */
  const beat = () => {
    if (o.key) post({ t: "here", key: o.key, hidden: typeof document !== "undefined" && document.visibilityState === "hidden" });
  };

  ch.onmessage = (e: MessageEvent) => {
    const m = e.data as LinkMessage;
    if (!m || typeof m !== "object" || m.from === id || m.ws !== o.workspace) return;
    switch (m.t) {
      case "sync": {
        // The timeline comes only from the window whose panel sets it: a pop-out takes it unless that's this one,
        // the workspace only when it handed it to a pop-out.
        const { timeline, ready, ...rest } = m.s;
        const follow = o.role === "popout" ? !isBasis : basis != null;
        apply(() => o.sync.setState(follow ? { ...rest, ...(timeline && { timeline }), ...(ready && { ready }) } : rest));
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
          post({ t: "sync", s: snapshotSync() });
          post({ t: "store", s: snapshotStore() });
          post({ t: "tools", s: o.tools.get() });
          post({ t: "basis", key: basis });
        }
        break;
      case "rollcall":
        if (o.role === "popout" && o.key) {
          post({ t: "hello" });
          beat();
        }
        break;
      case "here":
        if (o.role === "workspace") {
          seen.set(m.key, { at: now(), hidden: !!m.hidden });
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
      case "basis":
        if (o.role === "popout") {
          isBasis = m.key === o.key;
          o.onBasis?.(isBasis);
        }
        break;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const popout = o.role === "popout" && !!o.key;
  if (popout) {
    post({ t: "hello" });
    beat();
    timer = setInterval(beat, HEARTBEAT_MS);
    // Going hidden or coming back is said at once: the workspace waits longer for a hidden window.
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", beat);
  } else {
    // Pop-outs left open while the workspace reloaded: they say hello and catch up.
    post({ t: "rollcall" });
    timer = setInterval(reportPopouts, HEARTBEAT_MS);
  }

  return {
    sendTools(patch) {
      if (!applying) post({ t: "tools", s: patch });
    },
    expect(key) {
      seen.set(key, { at: now(), hidden: false });
      reportPopouts();
    },
    recall(key) {
      post({ t: "recall", key });
      seen.delete(key);
      reportPopouts();
    },
    setBasis(key) {
      if (key === basis) return;
      basis = key;
      post({ t: "basis", key });
    },
    close() {
      if (timer) clearInterval(timer);
      if (popout) {
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", beat);
        post({ t: "bye", key: o.key! });
      }
      unsubSync();
      unsubStore();
      ch.onmessage = null;
      ch.close();
    },
  };
}

/** This tab's workspace id: the same after a reload (its pop-outs stay its own), new in another tab. */
export function workspaceId(): string {
  const fresh = () => Math.random().toString(36).slice(2, 10);
  try {
    const saved = sessionStorage.getItem("stormcentral:pro-workspace");
    if (saved) return saved;
    const id = fresh();
    sessionStorage.setItem("stormcentral:pro-workspace", id);
    return id;
  } catch {
    // No session storage (blocked): a reload loses touch with the open pop-outs.
    return fresh();
  }
}

/** The pop-out's address: a chromeless page showing one panel of workspace `ws`. */
export const popoutUrl = (key: PopoutKey, ws: string) => `/pro-window?view=${encodeURIComponent(key)}&ws=${encodeURIComponent(ws)}`;

/** Open (or bring forward) a pop-out window. The desktop app places it on another monitor. */
export function openPopout(key: PopoutKey, ws: string): void {
  window.open(popoutUrl(key, ws), `stormcentral-pro-${ws}-${key}`, "popup,width=960,height=720");
}
