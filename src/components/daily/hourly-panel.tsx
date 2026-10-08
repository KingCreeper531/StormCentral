"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Forecast } from "@/lib/api/open-meteo";
import { convertTemp } from "@/lib/weather/units";
import { fmtIn, hourRange, msTimes, pick } from "@/lib/weather/view";
import { iconName } from "@/lib/weather/wmo";
import { useFormat } from "@/hooks/use-format";
import { cn } from "@/lib/utils";
import { TimeSeriesChart } from "../charts/time-series";
import { IconButton } from "../ui/button";
import { Panel } from "../ui/panel";
import { WeatherIcon } from "../ui/weather-icon";

/** Tracks whether a horizontal scroller is at either end (for the paging buttons). */
function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft <= 1;
      const end = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    el.addEventListener("scroll", update, { passive: true });
    // Also delivers the initial measurement.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return [ref, edges] as const;
}

/**
 * Hour-by-hour strip (time, icon, temperature, chance of precipitation) with a
 * temperature curve for the 24-hour trend. Touch devices swipe the strip;
 * mouse and trackpad users also get paging buttons.
 */
export function HourlyPanel({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const { idx } = hourRange(f, now, 25);
  const hourFmt = fmtIn(f.timezone, { hour: "numeric" });
  const times = msTimes(f, idx);
  const temps = pick(f.hourly.temp, idx).map((v) => (v == null ? null : convertTemp(v, fmt.units.temp)));
  const [listRef, edges] = useScrollEdges<HTMLOListElement>();

  const page = (dir: 1 | -1) => {
    const el = listRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <Panel
      title="Hourly forecast"
      subtitle="Next 24 hours"
      className={className}
      action={
        <div className="hidden gap-1 pointer-fine:flex">
          <IconButton label="Earlier hours" size="sm" disabled={edges.start} onClick={() => page(-1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="Later hours" size="sm" disabled={edges.end} onClick={() => page(1)}>
            <ChevronRight className="size-4" aria-hidden />
          </IconButton>
        </div>
      }
    >
      {/* Bleeds to the panel edges so the strip scrolls edge to edge on phones. */}
      <ol
        ref={listRef}
        className="no-scrollbar -mx-4 flex snap-x scroll-px-4 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:-mx-5 sm:scroll-px-5 sm:px-5"
        aria-label="Hourly forecast"
        tabIndex={0}
        // Keyboard-scrollable; inset the focus ring so the panel edge doesn't clip it.
        style={{ outlineOffset: -2 }}
      >
        {idx.map((i, k) => {
          const pop = f.hourly.precipProb[i] ?? 0;
          return (
            <li key={i} className="flex w-12 shrink-0 snap-start flex-col items-center gap-1 py-1 text-center sm:w-14">
              <span className={cn("text-xs tabular", k === 0 ? "font-medium text-ink" : "text-ink-3")}>
                {k === 0 ? "Now" : hourFmt.format(f.hourly.time[i]! * 1000)}
              </span>
              <WeatherIcon name={iconName(f.hourly.code[i], f.hourly.isDay[i] === 1)} size={36} animated={false} />
              <span className="text-sm font-medium text-ink tabular">{fmt.temp(f.hourly.temp[i])}</span>
              <span className="h-4 text-[11px] text-ink-2 tabular">
                {pop >= 20 ? (
                  <>
                    {pop}%<span className="sr-only"> chance of precipitation</span>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Chance of precipitation is already on the strip; the chart adds only the temperature trend. */}
      <div className="mt-3 border-t border-line pt-4">
        <p className="label mb-1">Temperature</p>
        <TimeSeriesChart
          ariaLabel="Temperature, next 24 hours"
          times={times}
          height={140}
          timeZone={f.timezone}
          series={[{ key: "t", label: "Temperature", color: "var(--color-series-2)", values: temps, kind: "area", format: (v) => `${Math.round(v)}°` }]}
        />
      </div>
    </Panel>
  );
}
