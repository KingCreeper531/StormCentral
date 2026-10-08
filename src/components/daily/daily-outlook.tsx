"use client";

import type { Forecast } from "@/lib/api/open-meteo";
import { convertTemp } from "@/lib/weather/units";
import { fmtIn, todayIndex } from "@/lib/weather/view";
import { describeCode, iconName } from "@/lib/weather/wmo";
import { useFormat } from "@/hooks/use-format";
import { cn } from "@/lib/utils";
import { Panel } from "../ui/panel";
import { WeatherIcon } from "../ui/weather-icon";

/** Temperature → colour for range bars (cold blue → hot red), in display units. */
function tempColor(c: number) {
  const stops: [number, string][] = [
    [-15, "#7dd3fc"],
    [0, "#38bdf8"],
    [10, "#34d399"],
    [20, "#facc15"],
    [28, "#fb923c"],
    [36, "#ef4444"],
  ];
  return (stops.find(([t]) => c <= t) ?? stops[stops.length - 1]!)[1];
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

export function DailyOutlook({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const start = todayIndex(f, now);
  const days = f.daily.time.map((_, i) => i).slice(start, start + 10);
  const lows = days.map((i) => f.daily.tMin[i] ?? 0);
  const highs = days.map((i) => f.daily.tMax[i] ?? 0);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const dayFmt = fmtIn(f.timezone, { weekday: "short" });
  const current = f.current.temp;

  return (
    <Panel title="10-day forecast" className={cn("flex flex-col", className)}>
      {/*
        Container query: in a narrow panel (phones, the desktop side column) the
        precipitation chance sits under the day name; wider panels give it a column.
        On desktop the panel may be stretched to match the column beside it, so the
        list fills it and shares any extra height evenly across the rows.
      */}
      <ul className="@container grid grid-cols-1 divide-y divide-line lg:flex-1 lg:auto-rows-fr">
        {days.map((i, k) => {
          const lo = f.daily.tMin[i] ?? 0;
          const hi = f.daily.tMax[i] ?? 0;
          const left = ((lo - min) / span) * 100;
          const width = Math.max(4, ((hi - lo) / span) * 100);
          const pop = f.daily.precipProbMax[i] ?? 0;
          const wet = pop >= 20;
          const popText = wet ? (
            <>
              {pop}%<span className="sr-only"> chance of precipitation</span>
            </>
          ) : null;
          return (
            <li
              key={i}
              className="grid min-h-11 grid-cols-[minmax(0,3.25rem)_1.75rem_2.25rem_minmax(0,1fr)_2.25rem] items-center gap-x-2 py-1.5 text-[13px] @md:grid-cols-[3.5rem_2rem_2.5rem_2.5rem_minmax(0,1fr)_2.5rem] @md:gap-x-3 @md:text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{k === 0 ? "Today" : dayFmt.format(f.daily.time[i]! * 1000)}</p>
                {wet && <p className="text-[11px] leading-4 text-ink-2 tabular @md:hidden">{popText}</p>}
              </div>
              <WeatherIcon name={iconName(f.daily.code[i], true)} size={32} fluid animated={false} label={describeCode(f.daily.code[i]).label} className="w-7 @md:w-8" />
              <span className="hidden text-xs text-ink-2 tabular @md:block">{popText}</span>
              <span className="text-right text-ink-3 tabular">
                <span className="sr-only">Low </span>
                {fmt.temp(lo)}
              </span>
              <span className="relative h-1.5 rounded-[2px] bg-surface-3" aria-hidden>
                <span
                  className="absolute inset-y-0 rounded-[2px]"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    // Data colouring (temperature scale), not decoration.
                    background: `linear-gradient(90deg, ${tempColor(convertTemp(lo, "C"))}, ${tempColor(convertTemp(hi, "C"))})`,
                  }}
                />
                {k === 0 && current != null && (
                  <span
                    className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-canvas"
                    style={{ left: `${clampPct(((current - min) / span) * 100)}%` }}
                  />
                )}
              </span>
              <span className="text-ink tabular">
                <span className="sr-only">High </span>
                {fmt.temp(hi)}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
