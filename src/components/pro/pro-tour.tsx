"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/use-t";
import type { TourStep } from "@/lib/pro/guide";
import { Button, IconButton } from "../ui/button";

const CARD_W = 320;
const GAP = 10;
const EDGE = 12;
/** Roughly the tallest a card gets; below this much room, it goes elsewhere. */
const CARD_ROOM = 190;

const target = (id: string) => document.querySelector<HTMLElement>(`[data-tour="${id}"]`);

/** The tour's stops whose element is on screen now (called when the tour starts). */
export function visibleSteps(steps: readonly TourStep[]): TourStep[] {
  return steps.filter((s) => {
    if (!s.target) return true;
    const r = target(s.target)?.getBoundingClientRect();
    return !!r && r.width > 0 && r.height > 0;
  });
}

/** Where the current stop's element is, with the viewport size: "x,y,w,h,vw,vh" (x..h empty when there's none). */
function useTargetBox(id: string | null): number[] | null {
  const key = useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      window.addEventListener("scroll", cb, true);
      // Layout can also move without either (a panel opening, a map loading).
      const timer = setInterval(cb, 400);
      return () => {
        window.removeEventListener("resize", cb);
        window.removeEventListener("scroll", cb, true);
        clearInterval(timer);
      };
    },
    () => {
      const r = id ? target(id)?.getBoundingClientRect() : null;
      const box = r && r.width > 0 && r.height > 0 ? [r.left, r.top, r.width, r.height].map(Math.round) : [];
      return [...box, window.innerWidth, window.innerHeight].join(",");
    },
    () => "",
  );
  return key ? key.split(",").map(Number) : null;
}

/**
 * The optional guided tour of the Professional workspace: a highlight over
 * each part (found by its `data-tour` attribute) and a card explaining it.
 * Started only from the guide; Esc, the close button or the last step ends it.
 */
export function ProTour({ steps, onClose }: { steps: readonly TourStep[]; onClose: () => void }) {
  const t = useT();
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)]!;
  const nums = useTargetBox(step.target);
  const next = useRef<HTMLButtonElement>(null);
  const last = i >= steps.length - 1;

  // The workspace's own keys (Space, ←, →) mustn't move the loop underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      // Space still presses the focused button (on key up); it just doesn't reach the loop.
      else if (e.key !== " ") return;
      if (e.key !== " ") e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, steps.length]);

  useEffect(() => {
    next.current?.focus();
  }, [i]);

  if (!nums) return null;
  const vw = nums.at(-2)!;
  const vh = nums.at(-1)!;
  const box = nums.length === 6 ? { x: nums[0]!, y: nums[1]!, w: nums[2]!, h: nums[3]! } : null;
  const w = Math.min(CARD_W, vw - 2 * EDGE);
  const clampX = (x: number) => Math.max(EDGE, Math.min(vw - w - EDGE, x));

  let card: React.CSSProperties = { left: (vw - w) / 2, top: "50%", transform: "translateY(-50%)", width: w };
  if (box) {
    if (vh - (box.y + box.h) >= CARD_ROOM + GAP) card = { left: clampX(box.x), top: box.y + box.h + GAP, width: w };
    else if (box.y >= CARD_ROOM + GAP) card = { left: clampX(box.x), bottom: vh - box.y + GAP, width: w };
    else if (box.x >= w + GAP + EDGE) card = { left: box.x - w - GAP, top: "50%", transform: "translateY(-50%)", width: w };
    else if (vw - (box.x + box.w) >= w + GAP + EDGE) card = { left: box.x + box.w + GAP, top: "50%", transform: "translateY(-50%)", width: w };
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="presentation">
      {/* Blocks clicks on the workspace while the tour is up. */}
      <div className={box ? "absolute inset-0" : "absolute inset-0 bg-black/55"} />
      {box && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[6px] ring-2 ring-accent transition-all duration-200"
          style={{ left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-tour-title"
        className="absolute rounded-[var(--radius-control)] border border-line-strong bg-surface-1 p-3.5 shadow-2xl"
        style={card}
      >
        <div className="flex items-start gap-2">
          <h2 id="pro-tour-title" className="flex-1 text-[14px] font-semibold text-ink">
            {t(step.title)}
          </h2>
          <IconButton size="sm" label={t("End tour")} onClick={onClose} className="-mt-1 -mr-1">
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{t(step.body)}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1 text-[11px] text-ink-3 tabular-nums">{t("Step {n} of {total}", { n: i + 1, total: steps.length })}</span>
          {i > 0 && (
            <Button size="sm" onClick={() => setI(i - 1)}>
              {t("Back")}
            </Button>
          )}
          <Button ref={next} size="sm" variant="primary" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? t("Done") : t("Next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
