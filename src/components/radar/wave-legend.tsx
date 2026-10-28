"use client";

import { useId } from "react";
import { useFormat } from "@/hooks/use-format";
import type { WaveGrid } from "@/lib/api/open-meteo-marine";
import { useT } from "@/lib/i18n/use-t";
import { WAVE_GRADIENT, WAVE_LEGEND_M, waveStopAt, waveTick } from "@/lib/marine";
import { cn } from "@/lib/utils";
import { fmtIn } from "@/lib/weather/view";

const RANGE = "block h-7 w-full accent-[var(--color-accent)] pointer-coarse:h-9";

/**
 * Key and time slider for the wave forecast overlay: which hour of the next
 * two days the map shows, and the wave height scale in the person's unit.
 */
export function WaveLegend({
  grid,
  hour,
  onHour,
  pending,
  error,
  timeZone,
  className,
}: {
  grid: WaveGrid | undefined;
  hour: number;
  onHour: (hour: number) => void;
  pending: boolean;
  error: unknown;
  timeZone: string | undefined;
  className?: string;
}) {
  const t = useT();
  const fmt = useFormat();
  const id = useId();
  const hours = grid?.times.length ?? 0;
  const h = Math.min(hour, Math.max(0, hours - 1));
  const at = grid?.times[h];
  const when = at == null ? null : fmtIn(timeZone, { weekday: "short", hour: "numeric" }, t.locale).format(at);

  return (
    <div data-chrome className={cn("overlay w-full max-w-sm px-2.5 py-2", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <label htmlFor={id} className="truncate font-medium text-ink">
          {t("Wave forecast")}
        </label>
        <span className="shrink-0 text-[11px] text-ink-3 tabular">
          {error && !hours ? t("Unavailable") : pending && !hours ? t("Loading") : when ? `${when} · ${h === 0 ? t("Now") : t("+{n} h", { n: h })}` : t("No forecast")}
        </span>
      </div>
      {hours > 1 && (
        <input
          id={id}
          type="range"
          min={0}
          max={hours - 1}
          step={1}
          value={h}
          onChange={(e) => onHour(Number(e.target.value))}
          aria-valuetext={when ?? undefined}
          className={RANGE}
        />
      )}
      {/* Data legend: the gradient is the colour scale itself. */}
      <div className="mt-1 h-1.5 rounded-[2px]" style={{ background: WAVE_GRADIENT }} aria-hidden />
      <div className="relative mt-1 h-4 text-[11px] text-ink-3 tabular" aria-hidden>
        {WAVE_LEGEND_M.map((m, i) => (
          <span
            key={m}
            className={cn("absolute top-0", i === 0 ? "left-0" : i === WAVE_LEGEND_M.length - 1 ? "right-0" : "-translate-x-1/2")}
            style={i === 0 || i === WAVE_LEGEND_M.length - 1 ? undefined : { left: `${waveStopAt(m) * 100}%` }}
          >
            {waveTick(m, fmt.units.height)}
            {i === WAVE_LEGEND_M.length - 1 && `+ ${fmt.units.height}`}
          </span>
        ))}
      </div>
      <p className="mt-0.5 text-[11px] text-ink-3">{t("Significant wave height, Open-Meteo marine forecast")}</p>
    </div>
  );
}
