"use client";

import { useState } from "react";
import type { ScoreResult } from "@/lib/science/scores";
import type { WindSample } from "@/lib/science/wind";
import { fmtIn } from "@/lib/weather/view";
import { useFormat } from "@/hooks/use-format";
import { cn } from "@/lib/utils";
import { Panel } from "../ui/panel";
import { StatusText, statusColor } from "../ui/status";

export const VERDICT: Record<ScoreResult["status"], string> = { go: "Good to fly", caution: "Fly with caution", "no-go": "Grounded" };

export interface FlightHour {
  i: number;
  t: number;
  atAlt: WindSample | null;
  gustAtAlt: number;
  result: ScoreResult;
}

/**
 * Hourly go / caution / no-go strip. Phones: 12 columns over two rows with an
 * hour label every 3 hours; md+: one row of 24. Pointing at or tapping a cell
 * shows that hour in the readout underneath, so nothing depends on hover.
 */
export function FlightWindows({ hours, timeZone, className }: { hours: FlightHour[]; timeZone: string; className?: string }) {
  const fmt = useFormat();
  const [sel, setSel] = useState<number | null>(null);
  const hourFmt = fmtIn(timeZone, { hour: "numeric" });
  const shown = sel != null && sel < hours.length ? sel : 0;
  const h = hours[shown];
  const hourLabel = (k: number, t: number) => (k === 0 ? "Now" : hourFmt.format(t));

  return (
    <Panel title="Flight windows" subtitle="Next 24 hours" className={className}>
      <ol
        aria-label="Hourly flight status"
        className="grid grid-cols-12 gap-x-[2px] gap-y-3 md:grid-cols-24"
        onPointerLeave={(e) => {
          // Touch pointers "leave" right after lifting; keep the tapped hour selected.
          if (e.pointerType === "mouse") setSel(null);
        }}
      >
        {hours.map((hr, k) => {
          const verdict = VERDICT[hr.result.status];
          const text = `${hourFmt.format(hr.t)}: ${verdict} (${hr.result.score})`;
          return (
            <li key={hr.i} title={text} className="flex min-w-0 flex-col" onPointerEnter={() => setSel(k)} onPointerDown={() => setSel(k)}>
              <span
                aria-hidden
                className="h-10 rounded-[2px]"
                style={{ background: statusColor(hr.result.status), opacity: 0.35 + (hr.result.score / 100) * 0.65 }}
              />
              <span aria-hidden className={cn("mt-1 h-0.5 rounded-[1px]", k === shown ? "bg-accent" : "bg-transparent")} />
              <span
                aria-hidden
                className={cn(
                  "mt-1 text-[10px] leading-none whitespace-nowrap tabular",
                  k === 0 ? "font-medium text-ink-2" : "text-ink-3",
                  k % 3 !== 0 && "invisible lg:visible",
                )}
              >
                {hourLabel(k, hr.t)}
              </span>
              <span className="sr-only">{text}</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3 lg:flex-row lg:items-center lg:justify-between">
        {h && (
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="min-w-12 font-medium text-ink tabular">{hourLabel(shown, h.t)}</span>
            <StatusText status={h.result.status} label={VERDICT[h.result.status]} />
            <span className="text-ink-2 tabular">Score {h.result.score}</span>
            <span className="text-ink-3 tabular">
              Wind {fmt.wind(h.atAlt?.speedMs)}, gusts {fmt.wind(h.gustAtAlt)}
            </span>
          </p>
        )}
        <div role="group" aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StatusText status="go" label="Go" className="text-xs text-ink-2" />
          <StatusText status="caution" label="Caution" className="text-xs text-ink-2" />
          <StatusText status="no-go" label="No-go" className="text-xs text-ink-2" />
          <span className="text-xs text-ink-3">Brighter cells score higher.</span>
        </div>
      </div>
    </Panel>
  );
}
