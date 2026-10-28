"use client";

import { CircleAlert, Pause, Play } from "lucide-react";
import type { ModelFieldState } from "@/hooks/use-model-field";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { useT } from "@/lib/i18n/use-t";
import { hourIndex } from "@/lib/model-fields/grid";
import { FIELDS, legendGradient, legendPosition, legendUnit, legendValue, type ModelFieldId } from "@/lib/model-fields/scales";
import { cn } from "@/lib/utils";
import { fmtIn } from "@/lib/weather/view";
import { IconButton } from "../ui/button";

/**
 * The model map's legend and time slider, docked above the radar timeline.
 * Its own hours (the next 48, from Open-Meteo) run independently of the
 * radar loop.
 */
export function ModelFieldBar({ field, model, timeZone, className }: { field: ModelFieldId; model: ModelFieldState; timeZone?: string; className?: string }) {
  const t = useT();
  const { units } = useFormat();
  const now = useNow(60_000);
  const def = FIELDS[field];
  const n = model.times.length;
  const time = model.times[model.index];
  // Hours after the one we're in (the grid starts at the current hour).
  const ahead = model.index - hourIndex(model.times, now);
  const when =
    time == null
      ? model.error
        ? ""
        : t("Loading")
      : `${fmtIn(timeZone, { weekday: "short", hour: "numeric" }, t.locale).format(time)} · ${ahead <= 0 ? t("Now") : t("In {h} h", { h: ahead })}`;

  return (
    <div data-chrome className={cn("overlay w-full max-w-sm px-2.5 py-2", className)}>
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-medium text-ink">{t(def.label)}</span> <span className="font-mono text-[11px] text-ink-3">{legendUnit(def, units)}</span>
        </span>
        <span className="shrink-0 text-[11px] text-ink-3">{model.isFetching && time != null ? t("Updating…") : t("Open-Meteo forecast")}</span>
      </p>
      {/* Data legend: the gradient is the colour scale itself. */}
      <div className="mt-1.5 h-1.5 rounded-[2px]" style={{ background: legendGradient(def.stops) }} aria-hidden />
      <div className="relative mt-1 h-3.5 text-[11px] leading-none text-ink-3 tabular" aria-hidden>
        {def.ticks.map((v) => {
          const at = legendPosition(def.stops, v) * 100;
          // Centred under its colour, except at the ends where it would spill out.
          const edge = at <= 0 ? "translate-x-0" : at >= 100 ? "-translate-x-full" : "-translate-x-1/2";
          return (
            <span key={v} className={cn("absolute top-0", edge)} style={{ left: `${at}%` }}>
              {legendValue(def, v, units)}
            </span>
          );
        })}
      </div>

      <div className="mt-1 flex items-center gap-2">
        <IconButton size="sm" label={model.playing ? t("Pause model forecast") : t("Play model forecast")} onClick={model.togglePlay} disabled={n < 2}>
          {model.playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
        </IconButton>
        <input
          type="range"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={model.index}
          disabled={n < 2}
          onChange={(e) => model.setIndex(Number(e.target.value))}
          aria-label={t("Forecast hour")}
          aria-valuetext={when}
          className="block h-8 min-w-0 flex-1 accent-[var(--color-accent)] pointer-coarse:h-10"
        />
        <span className="shrink-0 text-[11px] text-ink-2 tabular">{when}</span>
      </div>
      {model.error ? (
        <p role="status" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-ink-2">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-nogo" aria-hidden />
          <span className="min-w-0 flex-1">{t("The model map couldn't load. Open-Meteo may be busy.")}</span>
          <button type="button" onClick={model.retry} className="shrink-0 font-medium text-accent hover:underline">
            {t("Retry")}
          </button>
        </p>
      ) : null}
    </div>
  );
}
