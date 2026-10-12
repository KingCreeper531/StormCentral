"use client";

import type { Forecast } from "@/lib/api/open-meteo";
import { useFormat } from "@/hooks/use-format";
import { fmtIn } from "@/lib/weather/view";
import { useGoogleWeather } from "./google-forecast-panel";
import { TimeSeriesChart } from "../charts/time-series";
import { Panel } from "../ui/panel";

/** Next 3 hours of 15-minute precipitation with a plain-language summary. */
export function NowcastCard({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const google = useGoogleWeather(f);
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

  // Second opinion from Google's AI forecast: its highest rain chance in the same 3 hours.
  let googleLine: string | null = null;
  if (google.data?.kind === "ok" && google.data.data.source === "graphcast") {
    // GraphCast gives amounts in 6-hour steps, no probabilities.
    const next = google.data.data.hours.filter((h) => Date.parse(h.time) > now && Date.parse(h.time) <= now + 6 * 3_600_000);
    const mm = next.reduce((sum, h) => sum + (h.precipMm ?? 0), 0);
    if (next.length) {
      const wetModel = wetNow || firstWet > 0;
      const wetAi = mm >= 0.2;
      googleLine = wetAi
        ? `Google's GraphCast AI ${wetModel ? "agrees" : "differs"}: about ${fmt.precip(mm)} in the next 6 hours`
        : `Google's GraphCast AI ${wetModel ? "differs" : "agrees"}: dry for the next 6 hours`;
    }
  } else if (google.data?.kind === "ok") {
    const end = now + 3 * 3_600_000;
    const hours = google.data.data.hours.filter((h) => {
      const t = Date.parse(h.time);
      return t + 3_600_000 > now && t < end && h.precipChance != null;
    });
    const peak = hours.reduce<(typeof hours)[number] | null>((best, h) => (!best || h.precipChance! > best.precipChance! ? h : best), null);
    if (peak) {
      const at = fmtIn(f.timezone, { hour: "numeric" }).format(Date.parse(peak.time));
      const wetModel = wetNow || firstWet > 0;
      const wetGoogle = peak.precipChance! >= 40;
      googleLine =
        peak.precipChance! < 15
          ? `Google AI: rain unlikely (${peak.precipChance}%)${wetModel ? ", so this may be brief or light" : ""}`
          : `Google AI ${wetModel === wetGoogle ? "agrees" : "differs"}: ${peak.precipChance}% chance of rain around ${at}`;
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
      {googleLine && <p className="label mt-2">{googleLine}</p>}
    </Panel>
  );
}
