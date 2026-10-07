"use client";

import type { Forecast } from "@/lib/api/open-meteo";
import { convertTemp } from "@/lib/weather/units";
import { fmtIn, todayIndex } from "@/lib/weather/view";
import { iconName } from "@/lib/weather/wmo";
import { useFormat } from "@/hooks/use-format";
import { GlassCard } from "../ui/glass-card";
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

export function DailyOutlook({ f, now }: { f: Forecast; now: number }) {
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
    <GlassCard eyebrow="10-day outlook" title="Daily forecast">
      <ul className="divide-y divide-white/[0.06]">
        {days.map((i, k) => {
          const lo = f.daily.tMin[i] ?? 0;
          const hi = f.daily.tMax[i] ?? 0;
          const left = ((lo - min) / span) * 100;
          const width = Math.max(4, ((hi - lo) / span) * 100);
          const pop = f.daily.precipProbMax[i] ?? 0;
          return (
            <li key={i} className="grid grid-cols-[3.2rem_2.5rem_2.5rem_2.6rem_1fr_2.6rem] items-center gap-2 py-2 text-sm">
              <span className="font-medium text-ink">{k === 0 ? "Today" : dayFmt.format(f.daily.time[i]! * 1000)}</span>
              <WeatherIcon name={iconName(f.daily.code[i], true)} size={34} animated={false} />
              <span className="text-[11px] font-medium text-sky-300">{pop >= 20 ? `${pop}%` : ""}</span>
              <span className="text-right text-ink-3 tabular">{fmt.temp(lo)}</span>
              <span className="relative h-1.5 rounded-full bg-white/[0.07]" aria-hidden>
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: `linear-gradient(90deg, ${tempColor(convertTemp(lo, "C"))}, ${tempColor(convertTemp(hi, "C"))})`,
                  }}
                />
                {k === 0 && current != null && (
                  <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-black" style={{ left: `${((current - min) / span) * 100}%` }} />
                )}
              </span>
              <span className="text-ink tabular">{fmt.temp(hi)}</span>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
