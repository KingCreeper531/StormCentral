import { describe, expect, it, vi } from "vitest";
import { paceFrames } from "./pace";

/** A window with a 60 Hz requestAnimationFrame driven by hand, and CSS animations to pace. */
function fakeWindow(animations: { easing: string; duration: number | string }[] = []) {
  let pending = new Map<number, FrameRequestCallback>();
  let ids = 0;
  let now = 0;
  const listeners: (() => void)[] = [];
  const anims = animations.map((timing) => {
    const effect = { getTiming: () => ({ ...timing }), updateTiming: vi.fn((t: { easing: string }) => (timing.easing = t.easing)) };
    return { effect };
  });
  const win = {
    requestAnimationFrame: (cb: FrameRequestCallback) => (pending.set(++ids, cb), ids),
    cancelAnimationFrame: (id: number) => void pending.delete(id),
    addEventListener: (type: string, fn: () => void) => type === "animationstart" && listeners.push(fn),
    document: { getAnimations: () => anims },
  };
  /** One 60 Hz frame (or a later one after a pause). */
  const frame = (ms = 1000 / 60) => {
    now += ms;
    const run = pending;
    pending = new Map();
    for (const cb of run.values()) cb(now);
  };
  return { win: win as unknown as Window, frame, anims, animationStart: () => listeners.forEach((fn) => fn()), pending: () => pending.size };
}

/** How many times a page's own animation loop runs in `seconds` of 60 Hz frames. */
function loopRate(fps: number, seconds = 10) {
  const { win, frame } = fakeWindow();
  paceFrames(fps, win);
  let runs = 0;
  const loop = () => {
    runs++;
    win.requestAnimationFrame(loop);
  };
  win.requestAnimationFrame(loop);
  for (let i = 0; i < seconds * 60; i++) frame();
  return runs / seconds;
}

describe("paceFrames", () => {
  it("runs requestAnimationFrame at the stream's frame rate, on average for rates that don't divide 60", () => {
    expect(loopRate(30)).toBeCloseTo(30, 0);
    expect(loopRate(20)).toBeCloseTo(20, 0);
    expect(loopRate(25)).toBeCloseTo(25, 0);
    expect(loopRate(24)).toBeCloseTo(24, 0);
  });

  it("leaves 60 fps (and nonsense) alone", () => {
    for (const fps of [60, 0, NaN]) {
      const { win } = fakeWindow();
      const raf = win.requestAnimationFrame;
      paceFrames(fps, win);
      expect(win.requestAnimationFrame).toBe(raf);
    }
  });

  it("gives every callback of a frame the same time, and runs the rest when one throws", () => {
    vi.useFakeTimers();
    const { win, frame } = fakeWindow();
    paceFrames(30, win);
    const times: number[] = [];
    win.requestAnimationFrame(() => {
      throw new Error("boom");
    });
    win.requestAnimationFrame((t) => times.push(t));
    win.requestAnimationFrame((t) => times.push(t));
    frame();
    expect(times).toHaveLength(2);
    expect(times[0]).toBe(times[1]);
    expect(() => vi.runAllTimers()).toThrow("boom");
    vi.useRealTimers();
  });

  it("cancels a callback, and stops asking for frames when none is left", () => {
    const { win, frame, pending } = fakeWindow();
    paceFrames(30, win);
    const cb = vi.fn();
    const id = win.requestAnimationFrame(cb);
    win.cancelAnimationFrame(id);
    expect(pending()).toBe(0);
    for (let i = 0; i < 6; i++) frame();
    expect(cb).not.toHaveBeenCalled();
  });

  it("doesn't catch up after a pause", () => {
    const { win, frame } = fakeWindow();
    paceFrames(30, win);
    let runs = 0;
    const loop = () => {
      runs++;
      win.requestAnimationFrame(loop);
    };
    win.requestAnimationFrame(loop);
    frame();
    frame(5_000);
    runs = 0;
    for (let i = 0; i < 60; i++) frame();
    expect(runs).toBeCloseTo(30, -1);
  });

  it("steps linear CSS animations at the frame rate and leaves eased ones alone", () => {
    const { win, anims, animationStart } = fakeWindow([
      { easing: "linear", duration: 20_000 },
      { easing: "linear", duration: 1_400 },
      { easing: "linear", duration: 10 },
      { easing: "ease", duration: 300 },
      { easing: "linear", duration: "auto" },
    ]);
    paceFrames(30, win);
    animationStart();
    animationStart();
    expect(anims.map((a) => a.effect.updateTiming.mock.calls)).toEqual([
      [[{ easing: "steps(600, jump-none)" }]],
      [[{ easing: "steps(42, jump-none)" }]],
      // jump-none needs at least 2 steps
      [[{ easing: "steps(2, jump-none)" }]],
      [],
      [],
    ]);
  });
});
