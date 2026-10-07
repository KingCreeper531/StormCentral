"use client";

import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * Global keyboard shortcuts. Keys use KeyboardEvent.key; prefix "mod+" for
 * ⌘ (mac) / Ctrl (others). Ignored while typing in form fields unless the
 * combo uses a modifier.
 */
export function useHotkeys(map: Record<string, Handler>, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = (mod ? "mod+" : "") + (e.key.length === 1 ? e.key.toLowerCase() : e.key);
      const handler = ref.current[key];
      if (!handler) return;
      if (!mod && isTyping(e.target)) return;
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
