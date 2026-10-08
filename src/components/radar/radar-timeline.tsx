"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { RadarLoop } from "@/hooks/use-radar-loop";
import { SPEEDS, type Speed } from "@/lib/radar/playback";
import { cn } from "@/lib/utils";
import { clockIn } from "@/lib/weather/view";
import { IconButton } from "../ui/button";
import { Segmented } from "../ui/segmented";

function ago(t: number, now: number) {
  const m = Math.round((now - t) / 60_000);
  return m <= 0 ? "Now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

const clock = (timeZone?: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });

/**
 * Clock time of the current frame in the location's zone ("~4:12 PM" when the
 * scan time is estimated; the zone is named when it differs from the device's),
 * or null without frames.
 */
export function frameTimeLabel(loop: RadarLoop, timeZone?: string): string | null {
  const frame = loop.frames[loop.index];
  return frame ? `${frame.approximate ? "~" : ""}${clockIn(timeZone, frame.time)}` : null;
}

/**
 * Loop transport: play/pause, step, scrubber with per-frame buffer state
 * (solid tick = tiles in GPU, hollow = still loading), and speed.
 *
 * Layout adapts to the width it is given (container queries), not the
 * viewport: step buttons appear from ~450 px, the speed segmented control
 * from ~580 px; narrower bars get a single button that cycles the speed.
 * `compact` drops the step buttons and the speed control (unless
 * `showSpeed`), for short viewports and previews.
 * Drag across the scrubber to scrub (touch or mouse); arrow keys step.
 *
 * `legend` puts a colour scale in the same box: as a row above the controls
 * (`legendPosition="top"`) or at the end of the controls row (`"end"`).
 */
export function RadarTimeline({
  loop,
  speed,
  onSpeed,
  now,
  timeZone,
  compact = false,
  showSpeed = !compact,
  legend,
  legendPosition = "top",
  actions,
}: {
  loop: RadarLoop;
  speed: Speed;
  onSpeed: (s: Speed) => void;
  now: number;
  timeZone?: string;
  compact?: boolean;
  showSpeed?: boolean;
  legend?: React.ReactNode;
  legendPosition?: "top" | "end";
  /** Extra buttons at the end of the row (e.g. export). */
  actions?: React.ReactNode;
}) {
  const frame = loop.frames[loop.index];
  const fmt = clock(timeZone);
  const n = loop.frames.length;
  const timeLabel = frameTimeLabel(loop, timeZone) ?? (loop.isLoading ? "Loading scans" : "No scans");
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;

  const scrubTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
    if (i !== loop.index) loop.setIndex(i);
  };

  return (
    <div className="@container w-full">
      <div className="overlay">
        {legend && legendPosition === "top" && legend}
        <div className={cn("flex items-center", compact ? "gap-2 px-1.5 py-1.5" : "gap-2 p-1.5 @sm:gap-3 @sm:p-2")}>
          <div className="flex shrink-0 items-center gap-0.5">
            {!compact && (
              <IconButton label="Previous frame" size="sm" className="hidden @md:inline-flex" onClick={() => loop.step(-1)}>
                <ChevronLeft className="size-4" aria-hidden />
              </IconButton>
            )}
            <IconButton
              label={loop.playing ? "Pause radar loop" : "Play radar loop"}
              variant="primary"
              onClick={loop.toggle}
              disabled={n < 2}
              className={compact ? "size-8" : "size-10"}
            >
              {loop.playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
            </IconButton>
            {!compact && (
              <IconButton label="Next frame" size="sm" className="hidden @md:inline-flex" onClick={() => loop.step(1)}>
                <ChevronRight className="size-4" aria-hidden />
              </IconButton>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3 text-xs leading-4">
              <span className="shrink-0 font-medium text-ink tabular">{timeLabel}</span>
              <span className="flex min-w-0 items-baseline gap-2 text-ink-3 tabular">
                {n > 0 && loop.buffered < n && <span className="truncate">Buffering {loop.buffered}/{n}</span>}
                {frame && <span className="shrink-0">{ago(frame.time, now)}</span>}
              </span>
            </div>
            <div
              className={cn(
                "relative flex cursor-pointer touch-none items-center gap-[2px] select-none",
                compact ? "h-5" : "h-6 pointer-coarse:h-8",
              )}
              role="slider"
              aria-label="Radar frame"
              aria-valuemin={1}
              aria-valuemax={n}
              aria-valuenow={loop.index + 1}
              aria-valuetext={frame ? `${timeLabel}, ${ago(frame.time, now)}` : timeLabel}
              tabIndex={0}
              onKeyDown={(e) => {
                let handled = true;
                if (e.key === "ArrowLeft") loop.step(-1);
                else if (e.key === "ArrowRight") loop.step(1);
                else if (e.key === "Home" && n > 0) loop.setIndex(0);
                else if (e.key === "End" && n > 0) loop.setIndex(n - 1);
                else handled = false;
                // Don't let the page-level arrow hotkeys step a second time.
                if (handled) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onPointerDown={(e) => {
                if (n === 0 || e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                scrubTo(e);
              }}
              onPointerMove={(e) => {
                if (n > 0 && e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e);
              }}
            >
              {n === 0 && <span className="h-1.5 w-full rounded-[1px] bg-surface-3" aria-hidden />}
              {loop.frames.map((f, i) => {
                const current = i === loop.index;
                const ready = loop.ready[i];
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => loop.setIndex(i)}
                    className="group relative h-full min-w-0 flex-1"
                    aria-label={`Frame ${fmt.format(f.time)}`}
                    tabIndex={-1}
                  >
                    {/* The playhead snaps: no colour/size transition, so a tick is never tall-but-grey or short-but-blue. */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[1px]",
                        current
                          ? "h-4 bg-accent"
                          : ready
                            ? cn("h-1.5 group-hover:bg-ink", i === n - 1 ? "bg-ink-2" : "bg-ink-3")
                            : "h-1.5 border border-line-strong transition-[border-color] duration-100 group-hover:border-ink-3",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {legend && legendPosition === "end" && <div className="min-w-0 shrink-0">{legend}</div>}

          {showSpeed && (
            <>
              {!compact && (
                <Segmented
                  ariaLabel="Loop speed"
                  size="sm"
                  value={speed}
                  onChange={onSpeed}
                  className="hidden shrink-0 @xl:inline-flex"
                  options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
                />
              )}
              <button
                type="button"
                onClick={() => onSpeed(nextSpeed)}
                aria-label={`Loop speed ${speed}×, change to ${nextSpeed}×`}
                title="Loop speed"
                className={cn(
                  "h-8 min-w-11 shrink-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-xs font-medium text-ink tabular transition-colors hover:border-line-strong pointer-coarse:h-11",
                  !compact && "@xl:hidden",
                )}
              >
                {speed}×
              </button>
            </>
          )}
          {actions && <div className="flex shrink-0 items-center">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
