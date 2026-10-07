"use client";

import { animate, motion, useDragControls, useMotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useMeasure } from "@/hooks/use-measure";
import { cn } from "@/lib/utils";

export type Detent = "peek" | "half" | "full";
const ORDER: Detent[] = ["peek", "half", "full"];

interface SheetProps {
  /** Mobile detent (controlled). Ignored on desktop. */
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  /** Always-visible header row (title, tabs, summary). Dragging it moves the sheet. */
  header: React.ReactNode;
  children: React.ReactNode;
  ariaLabel: string;
  /** Visible height (px) of the header strip when peeking. */
  peekHeight?: number;
  /** Desktop placement/size classes (the sheet renders as a side panel there). */
  desktopClassName?: string;
  /**
   * Phones: content docked on top of the sheet (e.g. a map transport). It rides
   * 8 px above the sheet's top edge at peek and half, follows it while it is
   * dragged, and hides at the full detent, where it would be off-screen.
   */
  accessory?: React.ReactNode;
  /** Phones: the visible height (px) of each detent, reported whenever the layout changes. */
  onLayout?: (heights: Record<Detent, number>) => void;
}

function readPx(name: string) {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;height:var(${name})`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

/** Viewport height minus the fixed top bar and tab bar, kept fresh on resize. */
function measureLayout() {
  if (typeof window === "undefined") return { vh: 800, top: 52, bottom: 56 };
  return { vh: window.innerHeight, top: readPx("--topbar-h"), bottom: readPx("--tabbar-h") };
}

function useViewportLayout() {
  const [layout, setLayout] = useState(measureLayout);
  useEffect(() => {
    const on = () => setLayout(measureLayout());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return layout;
}

/**
 * Responsive sheet. Phones: a bottom sheet above the tab bar with
 * peek / half / full detents — drag the header or tap the handle. Desktop:
 * a plain side panel positioned by `desktopClassName`; it sizes to its
 * content and scrolls once it reaches its max height.
 */
export function Sheet({ detent, onDetentChange, header, children, ariaLabel, peekHeight = 76, desktopClassName, accessory, onLayout }: SheetProps) {
  const desktop = useIsDesktop();
  const { vh, top, bottom } = useViewportLayout();
  const [headerRef, headerSize] = useMeasure<HTMLDivElement>();
  const controls = useDragControls();
  const full = Math.max(peekHeight + 120, vh - top - bottom - 12);
  const heights: Record<Detent, number> = { peek: peekHeight, half: Math.round(full * 0.48), full };
  const y = useMotionValue(full - heights[detent]);
  const dragging = useRef(false);
  const layoutCb = useRef(onLayout);

  useEffect(() => {
    layoutCb.current = onLayout;
  });

  useEffect(() => {
    if (desktop || dragging.current) return;
    const ctrl = animate(y, full - heights[detent], { type: "spring", stiffness: 420, damping: 42 });
    return () => ctrl.stop();
    // heights derive from `full`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detent, full, desktop]);

  useEffect(() => {
    if (!desktop) layoutCb.current?.({ peek: peekHeight, half: Math.round(full * 0.48), full });
  }, [desktop, peekHeight, full]);

  if (desktop) {
    return (
      <aside aria-label={ariaLabel} className={cn("overlay flex flex-col overflow-hidden", desktopClassName)}>
        <div className="shrink-0 border-b border-line">{header}</div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    );
  }

  const snap = (velocityY: number) => {
    const projected = full - (y.get() + velocityY * 0.18);
    const nearest = ORDER.reduce((a, b) => (Math.abs(heights[b] - projected) < Math.abs(heights[a] - projected) ? b : a));
    animate(y, full - heights[nearest], { type: "spring", stiffness: 420, damping: 42 });
    if (nearest !== detent) onDetentChange(nearest);
  };
  const cycle = () => onDetentChange(detent === "full" ? "peek" : ORDER[ORDER.indexOf(detent) + 1]!);

  return (
    <motion.div
      className="fixed inset-x-0 z-30"
      style={{ y, height: full, bottom }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: full - heights.peek }}
      dragElastic={0.05}
      dragMomentum={false}
      onDragStart={() => (dragging.current = true)}
      onDragEnd={(_, info) => {
        dragging.current = false;
        snap(info.velocity.y);
      }}
    >
      {accessory && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-3 bottom-full mb-2 transition-opacity duration-150 [&>*]:pointer-events-auto",
            detent === "full" && "invisible opacity-0",
          )}
        >
          {accessory}
        </div>
      )}
      <section aria-label={ariaLabel} className="flex h-full flex-col overflow-hidden rounded-t-[var(--radius-sheet)] border-t border-line bg-surface-1">
        <div ref={headerRef} className="shrink-0 touch-none select-none" onPointerDown={(e) => controls.start(e)}>
          <button
            type="button"
            onClick={cycle}
            className="flex h-5 w-full items-center justify-center pointer-coarse:h-7"
            aria-label={detent === "full" ? "Collapse panel" : "Expand panel"}
          >
            <span className="h-1 w-9 rounded-full bg-line-strong" />
          </button>
          {header}
        </div>
        <div
          className={cn("min-h-0 overflow-y-auto overscroll-contain border-t border-line", detent === "peek" && "invisible")}
          style={{ height: Math.max(0, heights[detent] - headerSize.height) }}
        >
          {children}
        </div>
      </section>
    </motion.div>
  );
}
