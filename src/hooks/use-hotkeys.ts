"use client";

import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Focused controls that move with the arrow keys, and anything inside a dialog (it scrolls). */
const ARROW_CONTROLS = "[role=slider], [role=tab], [role=menuitem], [role=option], [role=radio], [role=dialog], dialog[open]";
/** Those, and every control Space presses (a button, link, switch…). */
const SPACE_CONTROLS = `${ARROW_CONTROLS}, button, a[href], [role=button], [role=switch], [role=checkbox]`;

/** Space or an arrow key that the focused control (or dialog) handles itself. */
function controlKey(e: KeyboardEvent) {
  const controls = e.key === " " ? SPACE_CONTROLS : e.key.startsWith("Arrow") ? ARROW_CONTROLS : null;
  return !!controls && e.target instanceof Element && !!e.target.closest(controls);
}

/**
 * Global keyboard shortcuts. Keys use KeyboardEvent.key; prefix "mod+" for
 * ⌘ (mac) / Ctrl (others). Ignored while typing in form fields unless the
 * combo uses a modifier, and plain Space and arrow keys are left to a focused
 * control that uses them (Space: buttons, links, switches…; arrows: sliders,
 * tabs, radio groups…) and to anything inside a dialog. Plain buttons don't
 * take the arrows, so the loop still steps after clicking one.
 */
export function useHotkeys(map: Record<string, Handler>, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = (mod ? "mod+" : "") + (e.key.length === 1 ? e.key.toLowerCase() : e.key);
      const handler = ref.current[key];
      if (!handler) return;
      if (!mod && isTyping(e.target)) return;
      if (!mod && controlKey(e)) return;
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
