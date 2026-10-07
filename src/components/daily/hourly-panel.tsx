"use client";

import type { Forecast } from "@/lib/api/open-meteo";
import { convertTemp } from "@/lib/weather/units";
import { fmtIn, hourRange, msTimes, pick } from "@/lib/weather/view";
import { iconName } from "@/lib/weather/wmo";
import { useFormat } from "@/hooks/use-format";
import { TimeSeriesChart } from "../charts/time-series";
import { GlassCard } from "../ui/glass-card";
import { WeatherIcon } from "../ui/weather-icon";

export function HourlyPanel({ f, now }: { f: Forecast; now: number }) {
  const fmt = useFormat();
  const { idx } = hourRange(f, now, 25);
  const hourFmt = fmtIn(f.timezone, { hour: "numeric" });
  const times = msTimes(f, idx);
  const temps = pick(f.hourly.temp, idx).map((v) => (v == null ? null : convertTemp(v, fmt.units.temp)));
  const pops = pick(f.hourly.precipProb, idx);

  return (
    <GlassCard eyebrow="Next 24 hours" title="Hourly forecast">
      <ol className="no-scrollbar -mx-1 flex snap-x gap-1 overflow-x-auto pb-2" aria-label="Hourly forecast">
        {idx.map((i, k) => (
          <li key={i} className="flex w-14 shrink-0 snap-start flex-col items-center gap-1 rounded-2xl py-2 text-center transition-colors hover:bg-white/5">
            <span className="text-[11px] font-medium text-ink-3">{k === 0 ? "Now" : hourFmt.format(f.hourly.time[i]! * 1000)}</span>
            <WeatherIcon name={iconName(f.hourly.code[i], f.hourly.isDay[i] === 1)} size={40} animated={false} />
            <span className="text-sm font-semibold text-ink">{fmt.temp(f.hourly.temp[i])}</span>
            <span className="h-3.5 text-[10px] font-medium text-sky-300">{(f.hourly.precipProb[i] ?? 0) >= 15 ? `${f.hourly.precipProb[i]}%` : ""}</span>
          </li>
        ))}
      </ol>
      <div className="mt-2 grid gap-4">
        <TimeSeriesChart
          ariaLabel="Temperature, next 24 hours"
          times={times}
          height={140}
          timeZone={f.timezone}
          series={[{ key: "t", label: "Temperature", color: "var(--color-series-2)", values: temps, kind: "area", format: (v) => `${Math.round(v)}°` }]}
        />
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Chance of precipitation</p>
          <TimeSeriesChart
            ariaLabel="Chance of precipitation, next 24 hours"
            times={times}
            height={84}
            timeZone={f.timezone}
            yDomain={[0, 100]}
            series={[{ key: "p", label: "Chance", color: "var(--color-series-1)", values: pops, kind: "bar", format: (v) => `${Math.round(v)}%` }]}
          />
        </div>
      </div>
    </GlassCard>
  );
}
