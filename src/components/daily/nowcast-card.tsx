"use client";

import type { Forecast } from "@/lib/api/open-meteo";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import { precipKind, rainOutlook, roundMinutes, type PrecipKind, type RainIntensity } from "@/lib/weather/rain-outlook";
import { TimeSeriesChart } from "../charts/time-series";
import { Panel } from "../ui/panel";

const WHAT: Record<PrecipKind, Record<RainIntensity, string>> = {
  rain: { light: "Light rain", moderate: "Rain", heavy: "Heavy rain" },
  snow: { light: "Light snow", moderate: "Snow", heavy: "Heavy snow" },
  mix: { light: "Light rain or snow", moderate: "Rain or snow", heavy: "Heavy rain or snow" },
};

/** Next 3 hours of 15-minute precipitation with a plain-language summary (the same reading as the rain-soon alert). */
export function NowcastCard({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const t = useT();
  const fmt = useFormat();
  const m = f.minutely15;
  if (!m || !m.time.length) return null;
  // Each value is the 15 minutes before its time, so the slot we're in is the first that ends after now.
  const start = m.time.findIndex((t) => t * 1000 > now);
  const idx = start < 0 ? [] : m.time.map((_, i) => i).slice(start, start + 12);
  const times = idx.map((i) => m.time[i]! * 1000);
  const vals = idx.map((i) => m.precip[i] ?? null);
  const o = rainOutlook(m.time, m.precip, now);
  const what = o ? t(WHAT[precipKind(f.current.temp)][o.intensity]) : "";
  const summary =
    !o || o.state === "dry"
      ? t("No precipitation expected in the next 3 hours")
      : o.state === "wet"
        ? o.endsInMin != null
          ? t("{what} ending in about {n} min", { what, n: roundMinutes(o.endsInMin) })
          : t("{what} continuing for the next few hours", { what })
        : (o.startsInMin ?? 0) < 5
          ? t("{what} starting in a few minutes", { what })
          : t("{what} starting in about {n} min", { what, n: roundMinutes(o.startsInMin ?? 0) });

  return (
    <Panel
      className={className}
      // The summary is a sentence: let it wrap on narrow screens instead of truncating.
      title={<span className="whitespace-normal">{summary}</span>}
      // The y-axis ticks are bare numbers, so the unit lives here.
      subtitle={fmt.units.precip === "in" ? t("Next 3 hours, inches per 15 minutes") : t("Next 3 hours, mm per 15 minutes")}
    >
      <TimeSeriesChart
        ariaLabel={t("Precipitation over the next three hours")}
        times={times}
        height={90}
        timeZone={f.timezone}
        yDomain={[0, Math.max(1, ...vals.map((v) => v ?? 0))]}
        series={[{ key: "p", label: t("Precipitation"), color: "var(--color-series-1)", values: vals, kind: "bar", format: (v) => fmt.precip(v), axisFormat: (v) => (v === 0 ? "0" : fmt.precip(v, false)) }]}
        tickEvery={4}
      />
    </Panel>
  );
}
