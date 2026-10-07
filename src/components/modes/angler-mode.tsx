"use client";

import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import type { Forecast } from "@/lib/api/open-meteo";
import type { RiverSite } from "@/lib/api/types";
import { moonIllumination } from "@/lib/astro/moon";
import { solunarForecast, type SolunarPeriod } from "@/lib/astro/solunar";
import { sunCrossings } from "@/lib/astro/sun";
import { estimateWaterTempC } from "@/lib/science/atmosphere";
import { tendencyAt } from "@/lib/science/pressure";
import { biteIndex, type BiteIndex } from "@/lib/science/scores";
import { convertPressure } from "@/lib/weather/units";
import { currentHourIndex, fmtIn, hourRange } from "@/lib/weather/view";
import { cn, mean } from "@/lib/utils";
import { useForecast, useRivers } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { TimeSeriesChart } from "../charts/time-series";
import { MoonDisc } from "../ui/dials";
import { GlassCard } from "../ui/glass-card";
import { EmptyState, ErrorNote, Skeleton, Stat } from "../ui/misc";
import { ScoreRing } from "../ui/score-ring";

const ACCENT = "#2dd4bf";

function hoursFromSunEvent(t: number, events: number[]) {
  return events.length ? Math.min(...events.map((e) => Math.abs(e - t))) / 3_600_000 : 99;
}

export function AnglerMode() {
  const forecast = useForecast();
  const rivers = useRivers();
  const now = useNow(60_000);
  const fmt = useFormat();
  const loc = useAppStore((s) => s.location);
  const [siteId, setSiteId] = useState<string | null>(null);
  const f = forecast.data;

  const sites = rivers.data?.sites ?? [];
  const site = sites.find((s) => s.id === siteId) ?? sites[0] ?? null;

  const model = useMemo(() => {
    if (!f) return null;
    const solunar = solunarForecast(new Date(now - 2 * 3_600_000), 30, loc.lat, loc.lon);
    const sunEvents = sunCrossings(new Date(now - 3_600_000), 30, loc.lat, loc.lon, -0.833).map((c) => c.time.getTime());
    const i0 = currentHourIndex(f, now);
    const airMean = mean(f.hourly.temp.slice(Math.max(0, i0 - 24), i0 + 1));
    const gaugeTemp = site?.waterTemp?.latest ?? null;
    const waterTemp = gaugeTemp ?? (Number.isFinite(airMean) ? estimateWaterTempC(airMean) : null);
    const inPeriod = (t: number, kind: SolunarPeriod["kind"]) => solunar.periods.some((p) => p.kind === kind && t >= p.start.getTime() && t <= p.end.getTime());

    const hours = hourRange(f, now, 24).idx.map((i) => {
      const t = f.hourly.time[i]! * 1000;
      const bite = biteIndex({
        tendency: tendencyAt(f.hourly.pressureMsl, i),
        inMajorPeriod: inPeriod(t + 1_800_000, "major"),
        inMinorPeriod: inPeriod(t + 1_800_000, "minor"),
        solunarDayRating: solunar.dayRating,
        hoursFromSunEvent: hoursFromSunEvent(t + 1_800_000, sunEvents),
        cloudPct: f.hourly.cloud[i] ?? 0,
        windMs: f.hourly.wind10[i] ?? 0,
        waterTempC: waterTemp,
        weatherCode: f.hourly.code[i] ?? 0,
        flowChange24h: site?.discharge?.change24h ?? null,
      });
      return { i, t, bite };
    });
    return { solunar, hours, waterTemp, waterTempIsEstimate: gaugeTemp == null };
  }, [f, now, loc.lat, loc.lon, site]);

  if (forecast.error && !f) return <ErrorNote error={forecast.error} what="the forecast" />;
  if (!f || !model) return <Skeleton className="h-96" />;

  const cur = model.hours[0]!;
  const tz = f.timezone;
  const timeFmt = fmtIn(tz, { hour: "numeric", minute: "2-digit" });
  const moon = moonIllumination(new Date(now));
  const upcoming = model.solunar.periods.filter((p) => p.end.getTime() > now).slice(0, 4);
  const bands = model.solunar.periods.map((p) => ({ from: p.start.getTime(), to: p.end.getTime(), color: p.kind === "major" ? "rgba(45,212,191,0.14)" : "rgba(45,212,191,0.07)" }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <BiteHero bite={cur.bite} className="lg:col-span-5" />

      <GlassCard className="lg:col-span-7" eyebrow="Next 24 hours · shaded = solunar periods" title="Bite index timeline">
        <TimeSeriesChart
          ariaLabel="Bite index by hour"
          times={model.hours.map((h) => h.t)}
          height={180}
          timeZone={tz}
          yDomain={[0, 100]}
          bands={bands}
          series={[{ key: "b", label: "Bite index", color: ACCENT, values: model.hours.map((h) => h.bite.score), kind: "bar", format: (v) => `${Math.round(v)}` }]}
        />
      </GlassCard>

      <GlassCard className="lg:col-span-4" eyebrow="Moon & solunar" title={moon.name}>
        <div className="flex items-center gap-4">
          <MoonDisc fraction={moon.fraction} waxing={moon.waxing} size={76} />
          <div className="space-y-1 text-sm">
            <p>
              <span className="font-semibold">{Math.round(moon.fraction * 100)}%</span> <span className="text-ink-3">illuminated</span>
            </p>
            <p className="text-ink-3">Day {moon.age.toFixed(1)} of the lunar cycle</p>
            <p className="flex items-center gap-0.5" aria-label={`Solunar day rating ${model.solunar.dayRating} of 4`}>
              {Array.from({ length: 4 }, (_, k) => (
                <Star key={k} className={cn("size-4", k < model.solunar.dayRating ? "fill-amber-300 text-amber-300" : "text-white/20")} aria-hidden />
              ))}
            </p>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5">
          {upcoming.map((p) => (
            <li key={`${p.event}-${p.peak.getTime()}`} className="flex items-center justify-between rounded-xl bg-white/[0.035] px-3 py-2 text-xs">
              <span>
                <span className={cn("mr-2 rounded px-1.5 py-px text-[10px] font-bold uppercase", p.kind === "major" ? "bg-teal-400/20 text-teal-200" : "bg-white/10 text-ink-2")}>{p.kind}</span>
                <span className="text-ink-2 capitalize">{p.event}</span>
                {p.coincidesWithSunEvent && <span className="ml-1 text-amber-300" title="Overlaps sunrise/sunset">★</span>}
              </span>
              <span className="font-medium text-ink tabular">
                {timeFmt.format(p.start)}–{timeFmt.format(p.end)}
              </span>
            </li>
          ))}
        </ul>
      </GlassCard>

      <PressureCard f={f} now={now} className="lg:col-span-4" />

      <GlassCard className="lg:col-span-4" eyebrow="Water" title="Water temperature">
        <p className="text-4xl font-semibold">{model.waterTemp != null ? fmt.temp(model.waterTemp, true) : "—"}</p>
        <p className="mt-1 text-xs text-ink-3">
          {model.waterTempIsEstimate ? "Estimated from 24 h mean air temperature (no gauge reports it nearby)" : `Measured at ${site?.name}`}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Wind" value={fmt.wind(f.current.windSpeed)} />
          <Stat label="Cloud cover" value={fmt.percent(f.current.cloud)} />
        </div>
      </GlassCard>

      <GlassCard className="lg:col-span-12" eyebrow="USGS real-time stream gauges" title="Rivers near you">
        {rivers.error ? (
          <ErrorNote error={rivers.error} what="river gauges" />
        ) : rivers.isLoading ? (
          <Skeleton className="h-40" />
        ) : !sites.length ? (
          <EmptyState title="No active stream gauges within ~60 km">USGS gauges cover the United States; try a location near a river.</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <ul className="space-y-1.5">
              {sites.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSiteId(s.id)} className={cn("w-full rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]", site?.id === s.id && "bg-white/[0.08] ring-1 ring-teal-400/40")}>
                    <p className="truncate text-sm font-medium text-ink">{s.name}</p>
                    <p className="text-xs text-ink-3">
                      {fmt.distanceKm(s.distanceKm)} · {s.discharge ? `${Math.round(s.discharge.latest).toLocaleString()} ${s.discharge.unit}` : "—"}
                      {s.discharge?.change24h != null && <ChangeTag v={s.discharge.change24h} />}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {site && <RiverDetail site={site} tz={tz} />}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function ChangeTag({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  return <span className={cn("ml-1.5 font-semibold", Math.abs(pct) < 5 ? "text-ink-3" : pct > 0 ? "text-sky-300" : "text-amber-300")}>{pct > 0 ? `▲${pct}%` : pct < 0 ? `▼${-pct}%` : "steady"}</span>;
}

function RiverDetail({ site, tz }: { site: RiverSite; tz: string }) {
  const fmt = useFormat();
  const q = site.discharge;
  const h = site.gageHeight;
  return (
    <div className="rounded-2xl bg-white/[0.03] p-4">
      <p className="text-sm font-semibold">{site.name}</p>
      <p className="text-xs text-ink-3">USGS {site.id}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Discharge" value={q ? `${Math.round(q.latest).toLocaleString()}` : "—"} sub={q?.unit} />
        <Stat label="Gage height" value={h ? `${h.latest.toFixed(2)}` : "—"} sub={h ? `${h.unit}${h.delta24h != null ? ` · ${h.delta24h >= 0 ? "+" : ""}${h.delta24h.toFixed(2)} / 24 h` : ""}` : undefined} />
        <Stat label="Water temp" value={site.waterTemp ? fmt.temp(site.waterTemp.latest, true) : "—"} />
      </div>
      {q && q.series.length > 2 && (
        <div className="mt-3">
          <TimeSeriesChart
            ariaLabel={`Discharge at ${site.name}, last 48 hours`}
            times={q.series.map((p) => p.t)}
            height={130}
            timeZone={tz}
            series={[{ key: "q", label: `Discharge (${q.unit})`, color: "var(--color-series-1)", values: q.series.map((p) => p.v), kind: "area", format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`) }]}
          />
        </div>
      )}
    </div>
  );
}

function PressureCard({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const i0 = currentHourIndex(f, now);
  const from = Math.max(0, i0 - 24);
  const to = Math.min(f.hourly.time.length, i0 + 25);
  const idx = Array.from({ length: to - from }, (_, k) => from + k);
  const t = tendencyAt(f.hourly.pressureMsl, i0);
  return (
    <GlassCard className={className} eyebrow="Barometer · 48 h" title={t ? `Pressure ${t.term}` : "Pressure"}>
      <p className="text-2xl font-semibold">
        {fmt.pressure(f.current.pressureMsl)} <span className="text-sm font-medium text-ink-2">{t ? `${fmt.pressureDelta(t.delta3h)} / 3 h` : ""}</span>
      </p>
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
      <p className="mt-2 text-[11px] text-ink-3">Falling pressure ahead of a front often triggers feeding; a sharp post-frontal rise shuts it down.</p>
    </GlassCard>
  );
}

function BiteHero({ bite, className }: { bite: BiteIndex; className?: string }) {
  return (
    <GlassCard className={className} eyebrow="Bite index · now" title={`${bite.label} conditions`}>
      <div className="flex flex-wrap items-center gap-5">
        <ScoreRing value={bite.score} color={ACCENT} label="Bite index">
          <div>
            <p className="text-4xl font-semibold">{bite.score}</p>
            <p className="text-[10px] tracking-wide text-ink-3 uppercase">{bite.label}</p>
          </div>
        </ScoreRing>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {bite.reasons.slice(0, 5).map((r) => (
            <li key={r.text} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-ink-2">{r.text}</span>
              <span className={cn("font-semibold tabular", r.delta > 0 ? "text-teal-300" : r.delta < 0 ? "text-amber-300" : "text-ink-3")}>
                {r.delta > 0 ? "+" : ""}
                {r.delta}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {bite.safety && <p className="mt-3 rounded-xl bg-nogo/12 px-3 py-2 text-xs font-medium text-ink ring-1 ring-nogo/30">⚡ {bite.safety}</p>}
    </GlassCard>
  );
}
