// @ts-check
import { screen } from "electron";
import { readFileSync, writeFileSync } from "node:fs";

/** @typedef {{ x?: number, y?: number, width: number, height: number }} Bounds */

/** @param {Bounds} b */
function onSomeDisplay(b) {
  if (b.x === undefined || b.y === undefined) return true;
  const { x, y } = b;
  return screen.getAllDisplays().some(({ workArea: a }) => x < a.x + a.width - 64 && x + b.width > a.x + 64 && y >= a.y - 8 && y < a.y + a.height - 64);
}

/** Last window size and position, if it still fits a connected display. */
export function loadWindowState(file) {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    const b = s?.bounds;
    if (b && [b.width, b.height].every(Number.isFinite) && b.width >= 360 && b.height >= 480 && onSomeDisplay(b)) {
      return { bounds: /** @type {Bounds} */ (b), maximized: Boolean(s.maximized) };
    }
  } catch {
    /* first launch or unreadable: use defaults */
  }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { bounds: { width: Math.min(1440, width), height: Math.min(900, height) }, maximized: false };
}

/** @param {import("electron").BrowserWindow} win @param {string} file */
export function trackWindowState(win, file) {
  win.on("close", () => {
    try {
      writeFileSync(file, JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
      /* not worth failing a quit over */
    }
  });
}
