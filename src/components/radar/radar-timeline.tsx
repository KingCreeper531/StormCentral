"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { motion } from "motion/react";
import type { RadarLoop } from "@/hooks/use-radar-loop";
import { SPEEDS, type Speed } from "@/lib/radar/playback";
import { cn } from "@/lib/utils";
import { Segmented } from "../ui/segmented";

function ago(t: number, now: number) {
  const m = Math.round((now - t) / 60_000);
  return m <= 0 ? "now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

/**
 * Loop transport: play/pause, step, scrubber with per-frame buffer state
 * (filled tick = tiles in GPU, hollow = still loading), and speed.
 */
export function RadarTimeline({
  loop,
  speed,
  onSpeed,
  now,
  timeZone,
  compact = false,
}: {
  loop: RadarLoop;
  speed: Speed;
  onSpeed: (s: Speed) => void;
  now: number;
  timeZone?: string;
  compact?: boolean;
}) {
  const frame = loop.frames[loop.index];
  const fmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  const n = loop.frames.length;

  return (
    <div className={cn("glass-strong flex items-center gap-3 rounded-2xl px-3 py-2", compact && "gap-2 px-2 py-1.5")}>
      <div className="flex items-center gap-1">
        {!compact && (
          <button type="button" onClick={() => loop.step(-1)} className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-white/10 hover:text-ink" aria-label="Previous frame">
            <ChevronLeft className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={loop.toggle}
          disabled={n < 2}
          className="grid size-9 place-items-center rounded-full bg-white text-black shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
          aria-label={loop.playing ? "Pause radar loop" : "Play radar loop"}
        >
          {loop.playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
        </button>
        {!compact && (
          <button type="button" onClick={() => loop.step(1)} className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-white/10 hover:text-ink" aria-label="Next frame">
            <ChevronRight className="size-4" />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
          <span className="tabular font-semibold text-ink">
            {frame ? `${frame.approximate ? "~" : ""}${fmt.format(frame.time)}` : loop.isLoading ? "Loading scans…" : "No scans"}
          </span>
          <span className="truncate text-ink-3">
            {frame ? ago(frame.time, now) : ""}
            {n > 0 && loop.buffered < n && ` · buffering ${loop.buffered}/${n}`}
          </span>
        </div>
        <div className="relative flex h-5 items-center gap-[3px]" role="slider" aria-label="Radar frame" aria-valuemin={1} aria-valuemax={n} aria-valuenow={loop.index + 1}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") loop.step(-1);
            if (e.key === "ArrowRight") loop.step(1);
          }}
        >
          {loop.frames.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => loop.setIndex(i)}
              className="group relative h-full flex-1"
              aria-label={`Frame ${fmt.format(f.time)}`}
              tabIndex={-1}
            >
              <span
                className={cn(
                  "absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-colors",
                  loop.ready[i] ? "bg-white/45 group-hover:bg-white/70" : "bg-white/10 ring-1 ring-white/15",
                  i === n - 1 && "bg-accent/70",
                )}
              />
              {i === loop.index && (
                <motion.span layoutId={compact ? "playhead-c" : "playhead"} className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,.8)]" transition={{ type: "spring", stiffness: 700, damping: 45 }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {!compact && (
        <Segmented
          ariaLabel="Loop speed"
          size="sm"
          value={speed}
          onChange={onSpeed}
          options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
        />
      )}
    </div>
  );
}
