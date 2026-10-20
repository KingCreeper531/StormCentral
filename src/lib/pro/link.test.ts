import { createStore } from "zustand/vanilla";
import { describe, expect, it, vi } from "vitest";
import { connectProLink, POPOUT_TIMEOUT_MS, type LinkOptions, type ToolPoints } from "./link";
import { createProSync } from "./sync";

/** BroadcastChannel stand-in: delivers to every other channel of the same name, synchronously. */
function hub() {
  const open = new Set<{ name: string; onmessage: ((e: MessageEvent) => void) | null }>();
  return (name: string) => {
    const ch = {
      name,
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage(data: unknown) {
        for (const other of open) if (other !== ch && other.name === name) other.onmessage?.({ data } as MessageEvent);
      },
      close() {
        open.delete(ch);
      },
    };
    open.add(ch);
    return ch;
  };
}

function windowOf(role: LinkOptions["role"], channel: LinkOptions["channel"], key?: string, clock = { t: 0 }) {
  const sync = createProSync();
  const store = createStore<Record<string, unknown>>()(() => ({ panes: ["ref"], tool: "inspect", layoutOnlyHere: 1 }));
  let tools: ToolPoints = { soundingAt: { lat: 35, lon: -97 }, xsect: null, selectedAlert: null };
  const popouts: string[][] = [];
  const recalled = vi.fn();
  const link = connectProLink({
    role,
    key,
    sync,
    store: { getState: store.getState, setState: (p) => store.setState(p), subscribe: store.subscribe, fields: ["panes", "tool"] },
    tools: { get: () => tools, set: (p) => (tools = { ...tools, ...p }) },
    onPopouts: (keys) => popouts.push([...keys].sort()),
    onRecall: recalled,
    channel,
    now: () => clock.t,
  });
  return { sync, store, link, popouts, recalled, tools: () => tools };
}

describe("Pro link between windows", () => {
  it("brings a new pop-out up to date and keeps both in step, without echoes", () => {
    const channel = hub();
    const ws = windowOf("workspace", channel);
    ws.sync.setState({ timeline: [1, 2, 3], index: 2 });
    ws.store.setState({ tool: "sounding" });
    const pop = windowOf("popout", channel, "p2");
    // The hello got the workspace's state.
    expect(pop.sync.getState().timeline).toEqual([1, 2, 3]);
    expect(pop.sync.getState().index).toBe(2);
    expect(pop.store.getState().tool).toBe("sounding");
    expect(pop.store.getState().layoutOnlyHere).toBe(1);

    // The pop-out pans: the workspace follows, tagged with the pane that moved.
    const posted = vi.spyOn(pop.link, "sendTools");
    pop.sync.setState({ camera: { lng: -90, lat: 40, zoom: 7, source: "p2" } });
    expect(ws.sync.getState().camera).toMatchObject({ lng: -90, source: "p2" });
    // The loop steps in the workspace: the pop-out follows.
    ws.sync.setState({ index: 0, playing: false });
    expect(pop.sync.getState()).toMatchObject({ index: 0, playing: false });
    // Only the workspace sets the timeline.
    pop.sync.setState({ timeline: [9] } as never);
    expect(ws.sync.getState().timeline).toEqual([1, 2, 3]);
    // Store and tools both ways.
    pop.store.setState({ panes: ["vel"] });
    expect(ws.store.getState().panes).toEqual(["vel"]);
    ws.link.sendTools({ selectedAlert: "a1" });
    expect(pop.tools().selectedAlert).toBe("a1");
    expect(posted).not.toHaveBeenCalled();
  });

  it("knows which panels are popped out, and calls them back", () => {
    const channel = hub();
    const clock = { t: 0 };
    const ws = windowOf("workspace", channel, undefined, clock);
    const pop = windowOf("popout", channel, "panel", clock);
    expect(ws.popouts.at(-1)).toEqual(["panel"]);
    ws.link.recall("panel");
    expect(pop.recalled).toHaveBeenCalledOnce();
    expect(ws.popouts.at(-1)).toEqual([]);
    pop.link.close();
    // A window that's asked for but never opens is let go after the timeout.
    ws.link.expect("p9");
    expect(ws.popouts.at(-1)).toEqual(["p9"]);
  });

  it("forgets a pop-out that stops answering", () => {
    vi.useFakeTimers();
    try {
      const base = hub();
      let muted = false;
      // The pop-out's window goes to sleep (or crashes) without saying goodbye: its messages stop.
      const channel: LinkOptions["channel"] = (name) => {
        const ch = base(name);
        const post = ch.postMessage.bind(ch);
        ch.postMessage = (data: unknown) => {
          if (!muted || (data as { t?: string }).t !== "here") post(data);
        };
        return ch;
      };
      const clock = { t: 0 };
      const ws = windowOf("workspace", channel, undefined, clock);
      windowOf("popout", channel, "p3", clock);
      expect(ws.popouts.at(-1)).toEqual(["p3"]);
      clock.t = 4_000;
      vi.advanceTimersByTime(4_000);
      expect(ws.popouts.at(-1)).toEqual(["p3"]);
      muted = true;
      clock.t = 4_000 + POPOUT_TIMEOUT_MS + 1;
      vi.advanceTimersByTime(POPOUT_TIMEOUT_MS + 2_000);
      expect(ws.popouts.at(-1)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
