"use client";

import type { Map as MlMap } from "maplibre-gl";
import { ArrowUpRight, Circle, Eraser, Hand, Minus, PenLine, Radio, Redo2, Type, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { DRAW_COLORS, DRAW_WIDTHS, simplify, type DrawKind, type LonLat } from "@/lib/draw/shapes";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { useDrawStore } from "@/store/draw-store";
import { IconButton } from "../ui/button";

type Pt = { x: number; y: number };
const newId = () => Math.random().toString(36).slice(2, 10);

const TOOLS: { id: DrawKind | null; label: string; Icon: typeof PenLine; key: string }[] = [
  { id: null, label: "Move the map", Icon: Hand, key: "m" },
  { id: "pen", label: "Pen", Icon: PenLine, key: "p" },
  { id: "line", label: "Line", Icon: Minus, key: "l" },
  { id: "arrow", label: "Arrow", Icon: ArrowUpRight, key: "a" },
  { id: "circle", label: "Circle", Icon: Circle, key: "c" },
  { id: "text", label: "Text", Icon: Type, key: "t" },
];

/** The stroke being drawn, in screen pixels, before it becomes a shape. */
function paintPreview(g: CanvasRenderingContext2D, tool: DrawKind, pts: readonly Pt[], color: string, width: number) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  if (pts.length < 2) return;
  const ratio = g.canvas.width / g.canvas.clientWidth || 1;
  g.save();
  g.scale(ratio, ratio);
  g.lineCap = "round";
  g.lineJoin = "round";
  const path = () => {
    g.beginPath();
    if (tool === "circle") {
      const r = Math.hypot(pts.at(-1)!.x - pts[0]!.x, pts.at(-1)!.y - pts[0]!.y);
      g.arc(pts[0]!.x, pts[0]!.y, r, 0, Math.PI * 2);
    } else {
      const line = tool === "pen" ? pts : [pts[0]!, pts.at(-1)!];
      g.moveTo(line[0]!.x, line[0]!.y);
      for (const p of line.slice(1)) g.lineTo(p.x, p.y);
    }
  };
  path();
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.lineWidth = width + 3;
  g.stroke();
  path();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
  if (tool === "arrow") {
    const a = pts[0]!;
    const b = pts.at(-1)!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const s = width >= 6 ? 16 : 11;
    g.beginPath();
    g.moveTo(b.x + Math.cos(ang) * s * 0.4, b.y + Math.sin(ang) * s * 0.4);
    g.lineTo(b.x + Math.cos(ang + 2.6) * s, b.y + Math.sin(ang + 2.6) * s);
    g.lineTo(b.x + Math.cos(ang - 2.6) * s, b.y + Math.sin(ang - 2.6) * s);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }
  g.restore();
}

/**
 * Takes the pointer while a drawing tool is picked (the "move" tool hands
 * the map back): strokes preview on a canvas and become shapes pinned to
 * the map when the pointer lifts. Text opens a small field where you click.
 */
export function DrawCanvas({ map }: { map: MlMap | null }) {
  const t = useT();
  const { tool, color, width, add } = useDrawStore();
  const canvas = useRef<HTMLCanvasElement>(null);
  const pts = useRef<Pt[]>([]);
  const drawing = useRef(false);
  const [label, setLabel] = useState<{ at: Pt; text: string } | null>(null);
  // The label being typed, read once when it's placed (Enter, then the field closing, must not add it twice).
  const labelRef = useRef(label);
  useEffect(() => {
    labelRef.current = label;
  });

  // Keep the canvas at the element's size, sharp on high-density screens.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      const r = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * r);
      c.height = Math.round(c.clientHeight * r);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [tool]);

  if (!tool || !map) return null;
  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toMap = (p: Pt): LonLat => {
    const ll = map.unproject([p.x, p.y]);
    return [ll.lng, ll.lat];
  };
  const preview = () => {
    const g = canvas.current?.getContext("2d");
    if (g) paintPreview(g, tool, pts.current, color, width);
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = local(e);
    if (tool === "text") {
      // No mouse events after this, so the click doesn't take the focus from the new field.
      e.preventDefault();
      setLabel({ at: p, text: "" });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    pts.current = [p];
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing.current) return;
    const p = local(e);
    const last = pts.current.at(-1)!;
    if (tool === "pen") {
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) pts.current.push(p);
    } else pts.current = [pts.current[0]!, p];
    preview();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const raw = pts.current;
    pts.current = [];
    preview();
    if (raw.length < 2) return;
    const a = raw[0]!;
    const b = raw.at(-1)!;
    // A tap isn't a shape.
    if (tool !== "pen" && Math.hypot(b.x - a.x, b.y - a.y) < 6) return;
    const line = tool === "pen" ? simplify(raw, 1.2) : [a, b];
    add({ id: newId(), kind: tool, color, width, points: line.map(toMap) });
  };
  const placeLabel = () => {
    const l = labelRef.current;
    labelRef.current = null;
    if (l?.text.trim()) add({ id: newId(), kind: "text", color, width, points: [toMap(l.at)], text: l.text.trim().slice(0, 60) });
    setLabel(null);
  };

  return (
    <div
      className={cn("absolute inset-0 z-30 touch-none", tool === "text" ? "cursor-text" : "cursor-crosshair")}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={(e) => map.zoomTo(map.getZoom() - Math.sign(e.deltaY) * 0.5, { around: map.unproject([e.nativeEvent.offsetX, e.nativeEvent.offsetY]) })}
    >
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" />
      {label && (
        <input
          autoFocus
          aria-label={t("Label text")}
          value={label.text}
          maxLength={60}
          placeholder={t("Type, then Enter")}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setLabel({ ...label, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") placeLabel();
            if (e.key === "Escape") setLabel(null);
            e.stopPropagation();
          }}
          onBlur={placeLabel}
          className="absolute h-8 w-56 -translate-y-1/2 rounded-[var(--radius-control)] border border-line-strong bg-surface-1/95 px-2 text-[14px] font-semibold outline-none"
          style={{ left: label.at.x, top: label.at.y, color }}
        />
      )}
    </div>
  );
}

/**
 * The drawing toolbar: tools, colours, line width, undo/redo, clear, and
 * (for presenters) putting the drawing on the live stream. Shortcuts:
 * M P L A C T for the tools, Ctrl+Z / Ctrl+Shift+Z, Esc to stop drawing.
 */
export function DrawToolbar({ presenter, airStatus, side = "right" }: { presenter: boolean; airStatus: "idle" | "sending" | "error"; side?: "left" | "right" }) {
  const t = useT();
  const s = useDrawStore();
  const keys: Record<string, (e: KeyboardEvent) => void> = {
    Escape: () => (s.tool ? s.setTool(null) : s.setOpen(false)),
    "mod+z": (e: KeyboardEvent) => (e.shiftKey ? s.redo() : s.undo()),
    "mod+y": s.redo,
  };
  for (const tool of TOOLS) keys[tool.key] = () => s.setTool(tool.id);
  useHotkeys(keys);

  return (
    <div
      role="toolbar"
      aria-label={t("Drawing tools")}
      className={cn("overlay absolute top-1/2 z-40 flex w-11 -translate-y-1/2 flex-col items-center gap-0.5 py-1.5", side === "left" ? "left-3" : "right-14 pointer-coarse:right-3")}
    >
      {TOOLS.map(({ id, label, Icon, key }) => (
        <IconButton key={label} size="sm" label={`${t(label)} (${key.toUpperCase()})`} aria-pressed={s.tool === id} onClick={() => s.setTool(id)} className={cn(s.tool === id && "bg-surface-3 text-ink")}>
          <Icon className="size-4" aria-hidden />
        </IconButton>
      ))}
      <span className="my-1 h-px w-6 bg-line" aria-hidden />
      {DRAW_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t("Colour {c}", { c })}
          aria-pressed={s.color === c}
          onClick={() => s.setColor(c)}
          className={cn("m-0.5 size-5 rounded-full border-2", s.color === c ? "border-ink" : "border-transparent")}
          style={{ background: c }}
        />
      ))}
      <button
        type="button"
        aria-label={s.width === DRAW_WIDTHS[1] ? t("Thick lines") : t("Thin lines")}
        title={t("Line width")}
        onClick={() => s.setWidth(s.width === DRAW_WIDTHS[0] ? DRAW_WIDTHS[1] : DRAW_WIDTHS[0])}
        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] hover:bg-surface-2"
      >
        <span className="w-5 rounded-full" style={{ height: s.width === DRAW_WIDTHS[1] ? 6 : 3, background: s.color }} />
      </button>
      <span className="my-1 h-px w-6 bg-line" aria-hidden />
      <IconButton size="sm" label={t("Undo")} disabled={!s.past.length} onClick={s.undo}>
        <Undo2 className="size-4" aria-hidden />
      </IconButton>
      <IconButton size="sm" label={t("Redo")} disabled={!s.future.length} onClick={s.redo}>
        <Redo2 className="size-4" aria-hidden />
      </IconButton>
      <IconButton size="sm" label={t("Clear the drawing")} disabled={!s.shapes.length} onClick={s.clear}>
        <Eraser className="size-4" aria-hidden />
      </IconButton>
      {presenter && (
        <>
          <span className="my-1 h-px w-6 bg-line" aria-hidden />
          <IconButton
            size="sm"
            label={s.onAir ? t("Take the drawing off the live stream") : t("Show the drawing on the live stream")}
            aria-pressed={s.onAir}
            onClick={() => s.setOnAir(!s.onAir)}
            className={cn(s.onAir && (airStatus === "error" ? "bg-caution/20 text-caution" : "bg-[#e5162b] text-white hover:bg-[#e5162b]"))}
          >
            <Radio className="size-4" aria-hidden />
          </IconButton>
        </>
      )}
      <IconButton size="sm" label={t("Stop drawing")} onClick={() => s.setOpen(false)}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}
