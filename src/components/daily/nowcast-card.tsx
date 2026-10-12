"use client";

import type { Forecast } from "@/lib/api/open-meteo";
import { useFormat } from "@/hooks/use-format";
import { fmtIn } from "@/lib/weather/view";
import { compareSource } from "@/lib/compare-sources";
import { useAppStore } from "@/store/app-store";
import { useCompareSeries } from "./use-compare";
import { TimeSeriesChart } from "../charts/time-series";
import { Panel } from "../ui/panel";

/** Next 3 hours of 15-minute precipitation with a plain-language summary. */
export function NowcastCard({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const pair = useAppStore((s) => s.compare);
  // Whichever of the two isn't the app's own forecast (nothing to add when both are).
  const otherId = pair.b !== "app" ? pair.b : pair.a;
  const second = useCompareSeries(otherId, f);
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

  // Second opinion from the comparison forecast picked in Settings: its rain in the same window.
  let secondLine: string | null = null;
  const other = second.data?.kind === "ok" && otherId !== "app" ? second.data.data : null;
  if (other) {
    const name = compareSource(otherId).short;
    const wetModel = wetNow || firstWet > 0;
    const end = now + 3 * 3_600_000;
    const hours = other.hours.filter((h) => {
      const t = Date.parse(h.time);
      return t + (other.stepHours ?? 1) * 3_600_000 > now && t < end;
    });
    const withChance = hours.filter((h) => h.precipChance != null);
    if (withChance.length) {
      const peak = withChance.reduce((best, h) => (h.precipChance! > best.precipChance! ? h : best));
      const at = fmtIn(f.timezone, { hour: "numeric" }).format(Date.parse(peak.time));
      const wetOther = peak.precipChance! >= 40;
      secondLine =
        peak.precipChance! < 15
          ? `${name}: rain unlikely (${peak.precipChance}%)${wetModel ? ", so this may be brief or light" : ""}`
          : `${name} ${wetModel === wetOther ? "agrees" : "differs"}: ${peak.precipChance}% chance of rain around ${at}`;
    } else if (hours.length) {
      const mm = hours.reduce((sum, h) => sum + (h.precipMm ?? 0), 0);
      const wetOther = mm >= 0.2;
      secondLine = wetOther
        ? `${name} ${wetModel ? "agrees" : "differs"}: about ${fmt.precip(mm)} in the next 3 hours`
        : `${name} ${wetModel ? "differs" : "agrees"}: dry for the next 3 hours`;
    }
  }

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
      {secondLine && <p className="label mt-2">{secondLine}</p>}
    </Panel>
  );
}
