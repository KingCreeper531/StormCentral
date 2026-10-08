"use client";

import { ArrowDown, ArrowUp, Minus, Sunrise, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import type { Forecast } from "@/lib/api/open-meteo";
import { moonIllumination } from "@/lib/astro/moon";
import type { SolunarForecast, SolunarPeriod } from "@/lib/astro/solunar";
import { tendencyAt } from "@/lib/science/pressure";
import type { BiteIndex } from "@/lib/science/scores";
import { convertPressure } from "@/lib/weather/units";
import { anglerModel } from "@/lib/weather/hourly-scores";
import { currentHourIndex, fmtIn } from "@/lib/weather/view";
import { cn } from "@/lib/utils";
import { useForecast, useRivers } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { RiversPanel } from "../angler/rivers-panel";
import { TimeSeriesChart } from "../charts/time-series";
import { MoonDisc } from "../ui/dials";
import { ScoreReadout } from "../ui/meter";
import { ErrorNote, Row, Skeleton, Stat } from "../ui/misc";
import { Panel } from "../ui/panel";

const BITE_COLOR = "var(--color-series-3)";
// Solunar periods shade the bite chart as neutral context behind the data,
// far enough apart in lightness that major and minor read as two levels.
const BAND_MAJOR = "rgba(255,255,255,0.14)";
const BAND_MINOR = "rgba(255,255,255,0.06)";

const CHIP = "inline-flex items-center rounded-[4px] border px-1.5 py-px text-[11px] font-medium";

const EVENT_LABEL: Record<SolunarPeriod["event"], string> = {
  transit: "Overhead",
  underfoot: "Underfoot",
  moonrise: "Moonrise",
  moonset: "Moonset",
};

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Phones: one column in reading order (bite index, hourly outlook, moon,
 * barometer, water, rivers). Desktop: a 12-column grid.
 */
export function AnglerMode() {
  const forecast = useForecast();
  const rivers = useRivers();
  const now = useNow(60_000);
  const fmt = useFormat();
  // lg: the chart shares a row with the bite panel, so it can be taller.
  const wide = useMediaQuery("(min-width: 1024px)");
  const loc = useAppStore((s) => s.location);
  const [siteId, setSiteId] = useState<string | null>(null);
  const f = forecast.data;

  const sites = rivers.data?.sites ?? [];
  const site = sites.find((s) => s.id === siteId) ?? sites[0] ?? null;

  const model = useMemo(
    () =>
      f
        ? anglerModel(f, now, loc.lat, loc.lon, { gaugeWaterTempC: site?.waterTemp?.latest ?? null, flowChange24h: site?.discharge?.change24h ?? null })
        : null,
    [f, now, loc.lat, loc.lon, site],
  );

  if (forecast.error && !f) return <ErrorNote error={forecast.error} what="the forecast" />;
  if (!f || !model)
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-busy="true">
        <Skeleton className="h-64 lg:col-span-5" />
        <Skeleton className="h-64 lg:col-span-7" />
        <Skeleton className="h-72 lg:col-span-4" />
        <Skeleton className="h-72 lg:col-span-4" />
        <Skeleton className="h-72 lg:col-span-4" />
        <Skeleton className="h-56 lg:col-span-12" />
      </div>
    );

  const cur = model.hours[0]!;
  const tz = f.timezone;
  const bands = model.solunar.periods.map((p) => ({ from: p.start.getTime(), to: p.end.getTime(), color: p.kind === "major" ? BAND_MAJOR : BAND_MINOR }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <BitePanel bite={cur.bite} className="lg:col-span-5" />

      <Panel title="Bite index by hour" subtitle="Next 24 hours" className="lg:col-span-7">
        <TimeSeriesChart
          ariaLabel="Bite index by hour, next 24 hours"
          times={model.hours.map((h) => h.t)}
          height={wide ? 200 : 180}
          timeZone={tz}
          yDomain={[0, 100]}
          bands={bands}
          series={[{ key: "b", label: "Bite index", color: BITE_COLOR, values: model.hours.map((h) => h.bite.score), kind: "bar", format: (v) => `${Math.round(v)}` }]}
        />
        <ul aria-label="Chart shading" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-3.5 shrink-0 rounded-[1px]" style={{ background: BAND_MAJOR }} aria-hidden />
            Solunar major period
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-3.5 shrink-0 rounded-[1px]" style={{ background: BAND_MINOR }} aria-hidden />
            Solunar minor period
          </li>
        </ul>
      </Panel>

      <SolunarPanel solunar={model.solunar} now={now} timeZone={tz} className="lg:col-span-4" />

      <PressurePanel f={f} now={now} className="lg:col-span-4" />

      <Panel title="Water" subtitle={model.waterTempIsEstimate ? "Estimated" : "Gauge reading"} className="lg:col-span-4">
        <p className="label">Water temperature</p>
        <p className="mt-0.5 text-3xl font-light text-ink tabular">{model.waterTemp != null ? fmt.temp(model.waterTemp, true) : "—"}</p>
        <p className="mt-1 text-xs text-ink-3">
          {model.waterTempIsEstimate ? "Estimated from the 24 h mean air temperature. No nearby gauge reports water temperature." : `Measured at ${site?.name}.`}
        </p>
        <div className="mt-3 divide-y divide-line border-t border-line">
          <Row label="Air temperature" value={fmt.temp(f.current.temp, true)} />
          <Row label="Wind" value={fmt.wind(f.current.windSpeed)} />
          <Row label="Cloud cover" value={fmt.percent(f.current.cloud)} />
        </div>
      </Panel>

      <RiversPanel
        sites={sites}
        selected={site}
        onSelect={setSiteId}
        error={rivers.error}
        loading={rivers.isLoading}
        timeZone={tz}
        className="lg:col-span-12"
      />
    </div>
  );
}

function BitePanel({ bite, className }: { bite: BiteIndex; className?: string }) {
  return (
    <Panel title="Bite index" subtitle="Current hour" className={className}>
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @min-[24rem]:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] @min-[24rem]:gap-6">
          <ScoreReadout score={bite.score} color={BITE_COLOR} label="Bite index" caption={<p className="text-sm font-medium text-ink">{bite.label}</p>} />
          <div className="min-w-0">
            <p className="label">Main factors</p>
            <ul className="mt-1 divide-y divide-line">
              {bite.reasons.slice(0, 5).map((r) => {
                const Icon = r.delta > 0 ? ArrowUp : r.delta < 0 ? ArrowDown : Minus;
                return (
                  <li key={r.text} className="flex items-start justify-between gap-3 py-1.5 text-[13px]">
                    <span className="min-w-0 text-ink-2">{r.text}</span>
                    <span className={cn("inline-flex shrink-0 items-center gap-0.5 font-medium tabular", r.delta > 0 ? "text-ink-2" : "text-ink-3")}>
                      <Icon className="size-3.5 shrink-0" aria-hidden />
                      {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `−${-r.delta}` : "0"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
      {bite.safety && (
        <p className="mt-4 flex items-start gap-2 border-l-[3px] border-nogo py-1 pl-3 text-[13px] text-ink">
          <Zap className="mt-0.5 size-4 shrink-0 text-nogo" aria-hidden />
          <span>
            <span className="sr-only">Safety: </span>
            {bite.safety}
          </span>
        </p>
      )}
    </Panel>
  );
}

function SolunarPanel({ solunar, now, timeZone, className }: { solunar: SolunarForecast; now: number; timeZone: string; className?: string }) {
  const moon = moonIllumination(new Date(now));
  const timeFmt = fmtIn(timeZone, { hour: "numeric", minute: "2-digit" });
  const upcoming = solunar.periods.filter((p) => p.end.getTime() > now).slice(0, 4);
  const anySunOverlap = upcoming.some((p) => p.coincidesWithSunEvent);

  return (
    <Panel title="Moon and solunar" subtitle="Upcoming feeding periods" className={className}>
      <div className="flex items-center gap-4">
        <MoonDisc fraction={moon.fraction} waxing={moon.waxing} size={56} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{sentence(moon.name)}</p>
          <p className="text-xs text-ink-3 tabular">
            {Math.round(moon.fraction * 100)}% illuminated, day {moon.age.toFixed(1)} of the cycle
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-ink-2">
            <span className="flex gap-0.5" aria-hidden>
              {Array.from({ length: 4 }, (_, k) => (
                <span key={k} className={cn("size-2 rounded-[1px]", k < solunar.dayRating ? "bg-ink-2" : "bg-surface-3")} />
              ))}
            </span>
            Day rating {solunar.dayRating} of 4
          </p>
        </div>
      </div>

      {upcoming.length ? (
        <table className="mt-4 w-full text-[13px]">
          <caption className="sr-only">Upcoming solunar periods</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label pb-1.5 text-left font-normal">
                Period
              </th>
              <th scope="col" className="label pb-1.5 text-left font-normal">
                Event
              </th>
              <th scope="col" className="label pb-1.5 text-right font-normal">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {upcoming.map((p) => (
              <tr key={`${p.event}-${p.peak.getTime()}`}>
                <td className="w-16 py-2 pr-2">
                  <span className={cn(CHIP, p.kind === "major" ? "border-line-strong text-ink" : "border-line text-ink-2")}>{p.kind === "major" ? "Major" : "Minor"}</span>
                </td>
                <td className="py-2 pr-2 text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    {EVENT_LABEL[p.event]}
                    {p.coincidesWithSunEvent && (
                      <>
                        <Sunrise className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                        <span className="sr-only">, overlaps sunrise or sunset</span>
                      </>
                    )}
                  </span>
                </td>
                <td className="py-2 text-right font-medium whitespace-nowrap text-ink tabular">
                  {timeFmt.format(p.start)}–{timeFmt.format(p.end)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">No solunar periods in the next day.</p>
      )}
      {anySunOverlap && (
        <p className="label mt-2 flex items-center gap-1.5">
          <Sunrise className="size-3.5 shrink-0" aria-hidden />
          Overlaps sunrise or sunset
        </p>
      )}
    </Panel>
  );
}

function PressurePanel({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const i0 = currentHourIndex(f, now);
  const from = Math.max(0, i0 - 24);
  const to = Math.min(f.hourly.time.length, i0 + 25);
  const idx = Array.from({ length: to - from }, (_, k) => from + k);
  const t = tendencyAt(f.hourly.pressureMsl, i0);
  return (
    <Panel title="Barometer" subtitle="Sea-level pressure, past and next 24 h" className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label">Now</p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-3xl font-light text-ink tabular">{fmt.pressure(f.current.pressureMsl, false)}</span>
            <span className="text-sm text-ink-3">{fmt.units.pressure}</span>
          </p>
        </div>
        <Stat label="3 h change" value={t ? fmt.pressureDelta(t.delta3h) : "—"} sub={t ? sentence(t.term) : undefined} className="shrink-0 text-right" />
      </div>
      <div className="mt-3">
        <TimeSeriesChart
          ariaLabel="Sea-level pressure, past and next 24 hours"
          times={idx.map((i) => f.hourly.time[i]! * 1000)}
          height={130}
          timeZone={f.timezone}
          now={now}
          series={[
            {
              key: "p",
              label: "Pressure",
              color: "var(--color-series-3)",
              values: idx.map((i) => {
                const v = f.hourly.pressureMsl[i];
                return v == null ? null : convertPressure(v, fmt.units.pressure);
              }),
              format: (v) => (fmt.units.pressure === "inHg" ? v.toFixed(2) : Math.round(v).toString()),
            },
          ]}
        />
      </div>
      <p className="mt-2 text-xs text-ink-3">Falling pressure ahead of a front often triggers feeding. A sharp rise after the front passes usually shuts it down.</p>
    </Panel>
  );
}
