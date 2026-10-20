"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { cleanShapes, DRAW_COLORS, DRAW_WIDTHS, LIMITS, type DrawKind, type Shape } from "@/lib/draw/shapes";

/**
 * Drawing on the radar map (components/draw): the shapes, undo and redo, the
 * tool, colour and width, and whether the drawing is on the live stream.
 * The shapes, colour and width are kept on this device.
 */
interface DrawState {
  shapes: Shape[];
  past: Shape[][];
  future: Shape[][];
  /** The toolbar is showing. */
  open: boolean;
  /** null: the map moves as usual. */
  tool: DrawKind | null;
  color: string;
  width: number;
  /** Sending the drawing to the live stream (presenters only; never remembered). */
  onAir: boolean;
  setOpen: (open: boolean) => void;
  setTool: (tool: DrawKind | null) => void;
  setColor: (color: string) => void;
  setWidth: (width: number) => void;
  add: (shape: Shape) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  setOnAir: (on: boolean) => void;
}

const HISTORY = 50;

export const useDrawStore = create<DrawState>()(
  persist(
    (set) => ({
      shapes: [],
      past: [],
      future: [],
      open: false,
      tool: null,
      color: DRAW_COLORS[0],
      width: DRAW_WIDTHS[0],
      onAir: false,
      setOpen: (open) => set(open ? { open, tool: "pen" } : { open, tool: null }),
      setTool: (tool) => set({ tool }),
      setColor: (color) => set({ color }),
      setWidth: (width) => set({ width }),
      add: (shape) =>
        set((s) => (s.shapes.length >= LIMITS.shapes ? {} : { shapes: [...s.shapes, shape], past: [...s.past, s.shapes].slice(-HISTORY), future: [] })),
      undo: () =>
        set((s) => {
          const prev = s.past.at(-1);
          return prev ? { shapes: prev, past: s.past.slice(0, -1), future: [s.shapes, ...s.future].slice(0, HISTORY) } : {};
        }),
      redo: () =>
        set((s) => {
          const next = s.future[0];
          return next ? { shapes: next, past: [...s.past, s.shapes].slice(-HISTORY), future: s.future.slice(1) } : {};
        }),
      clear: () => set((s) => (s.shapes.length ? { shapes: [], past: [...s.past, s.shapes].slice(-HISTORY), future: [] } : {})),
      setOnAir: (onAir) => set({ onAir }),
    }),
    {
      name: "stormcentral:draw:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ shapes, color, width }) => ({ shapes, color, width }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DrawState>;
        return {
          ...current,
          shapes: cleanShapes(p.shapes),
          color: (DRAW_COLORS as readonly string[]).includes(p.color as string) ? (p.color as string) : current.color,
          width: (DRAW_WIDTHS as readonly number[]).includes(p.width as number) ? (p.width as number) : current.width,
        };
      },
    },
  ),
);
