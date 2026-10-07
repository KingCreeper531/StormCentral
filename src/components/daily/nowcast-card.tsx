"use client";

import type { Forecast } from "@/lib/api/open-meteo";
import { useFormat } from "@/hooks/use-format";
import { TimeSeriesChart } from "../charts/time-series";
import { Panel } from "../ui/panel";

/** Next 3 hours of 15-minute precipitation with a plain-language summary. */
export function NowcastCard({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const m = f.minutely15;
  if (!m || !m.time.length) return null;
  const start = m.time.findIndex((t) => t * 1000 + 15 * 60_000 > now);
  const idx = start < 0 ? [] : m.time.map((_, i) => i).slice(start, start + 12);
  const times = idx.map((i) => m.time[i]! * 1000);
  const vals = idx.map((i) => m.precip[i] ?? null);
  const firstWet = vals.findIndex((v) => (v ?? 0) >= 0.1);
  const wetNow = (vals[0] ?? 0) >= 0.1;
  const lastWet = wetNow ? vals.findIndex((v) => (v ?? 0) < 0.1) : -1;
  const summary = wetNow
    ? lastWet > 0
      ? `Precipitation easing in about ${lastWet * 15} min`
      : "Precipitation continuing for the next few hours"
    : firstWet > 0
      ? `Precipitation starting in about ${firstWet * 15} min`
      : "No precipitation expected in the next 3 hours";

  return (
    <Panel
      className={className}
      // The summary is a sentence: let it wrap on narrow screens instead of truncating.
      title={<span className="whitespace-normal">{summary}</span>}
      // The y-axis ticks are bare numbers, so the unit lives here.
      subtitle={`Next 3 hours, ${fmt.units.precip === "in" ? "inches" : "mm"} per 15 minutes`}
    >
      <TimeSeriesChart
        ariaLabel="Precipitation over the next three hours"
        times={times}
        height={90}
        timeZone={f.timezone}
        yDomain={[0, Math.max(1, ...vals.map((v) => v ?? 0))]}
        series={[{ key: "p", label: "Precipitation", color: "var(--color-series-1)", values: vals, kind: "bar", format: (v) => fmt.precip(v), axisFormat: (v) => (v === 0 ? "0" : fmt.precip(v, false)) }]}
        tickEvery={4}
      />
    </Panel>
  );
}
