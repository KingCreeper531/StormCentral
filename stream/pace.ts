/**
 * Frame pacing for the stream's Chromium: director.ts runs this in every page
 * before the app's own scripts. ffmpeg captures the screen STREAM_FPS times a
 * second, but Chromium draws at 60, and on a server with no GPU every frame it
 * draws is the whole picture, made and copied on the CPU: the overlay's
 * 7-pixel pulsing LIVE dot alone kept 85% of a core busy (1280x720, measured).
 * So nothing on the page draws more often than it's captured:
 *
 * - requestAnimationFrame (the radar map's redraws, the app's JS animations)
 *   runs its callbacks at most `fps` times a second;
 * - CSS animations move in steps, `fps` of them a second (a 20 s ticker in 600
 *   at 30 fps), so the compositor only redraws when something has moved.
 *
 * Self-contained (no imports or outside names), because Playwright sends it to
 * the page as source.
 */
export function paceFrames(fps: number, win: Window = window) {
  if (!(fps > 0 && fps < 60)) return;
  const every = 1000 / fps;
  const native = win.requestAnimationFrame.bind(win);
  const cancelNative = win.cancelAnimationFrame.bind(win);
  let queue = new Map<number, FrameRequestCallback>();
  let ids = 0;
  let handle = 0;
  let due = -Infinity;
  const tick = (t: number) => {
    handle = 0;
    // 2 ms early is on time: frames come every 16.7 ms, so at 25 fps it's every 2nd and 3rd frame in turn.
    if (t < due - 2) {
      handle = native(tick);
      return;
    }
    // After a pause (a background tab) the next one counts from now, without catching up.
    due = (t - due > every ? t : due) + every;
    const run = queue;
    queue = new Map();
    for (const cb of run.values()) {
      try {
        cb(t);
      } catch (err) {
        // Reported like a native callback's error, and the rest still run.
        setTimeout(() => {
          throw err;
        });
      }
    }
  };
  win.requestAnimationFrame = (cb) => {
    queue.set(++ids, cb);
    if (!handle) handle = native(tick);
    return ids;
  };
  win.cancelAnimationFrame = (id) => {
    queue.delete(id);
    if (!queue.size && handle) {
      cancelNative(handle);
      handle = 0;
    }
  };

  // Only animations with a linear overall timing: a CSS animation's own easing is per keyframe and stays,
  // while a transition's easing is its overall one, and those are short anyway.
  const paced = new WeakSet<Animation>();
  const pace = () => {
    for (const a of win.document.getAnimations()) {
      if (paced.has(a)) continue;
      paced.add(a);
      const timing = a.effect?.getTiming();
      if (!timing || timing.easing !== "linear" || typeof timing.duration !== "number" || timing.duration <= 0) continue;
      a.effect!.updateTiming({ easing: `steps(${Math.max(2, Math.round((timing.duration / 1000) * fps))}, jump-none)` });
    }
  };
  win.addEventListener("animationstart", pace, true);
}
