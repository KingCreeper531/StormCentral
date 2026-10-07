"use client";

import { useMemo } from "react";
import { skyPhase, sunPosition } from "@/lib/astro/sun";
import { densityAltitudeM, estimateCeiling } from "@/lib/science/atmosphere";
import { DRONE_PROFILES, droneFlyability, type ScoreResult } from "@/lib/science/scores";
import { bulkShear, windAtHeight, type WindSample } from "@/lib/science/wind";
import { convertWind } from "@/lib/weather/units";
import { fmtIn, hourRange } from "@/lib/weather/view";
import { compassPoint } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { Forecast } from "@/lib/api/open-meteo";
import { useForecast, useGnss, useSpaceWeather } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { TimeSeriesChart } from "../charts/time-series";
import { CONSTELLATION_STYLE, CONSTELLATIONS, Marker, SkyPlot } from "../drone/sky-plot";
import { GlassCard } from "../ui/glass-card";
import { ErrorNote, Skeleton, Stat } from "../ui/misc";
import { ScoreRing } from "../ui/score-ring";
import { Segmented } from "../ui/segmented";
import { StatusBadge, statusColor } from "../ui/status";

const LEVELS = [10, 80, 120, 180] as const;
const LEVEL_COLORS = ["#9ec5f4", "#6da7ec", "#3987e5", "#256abf"]; // validated ordinal ramp

// 100–400 ft (Part 107 ceiling) or 30–120 m (EU Open category); stored in metres
// and snapped to the nearest option so labels and maths always agree.
const ALT_FT: readonly number[] = [100, 200, 300, 400].map((ft) => ft / 3.28084);
const ALT_M: readonly number[] = [30, 60, 90, 120];
const snap = (options: readonly number[], v: number) => options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

function profileAt(f: Forecast, i: number): WindSample[] {
  const speeds = [f.hourly.wind10, f.hourly.wind80, f.hourly.wind120, f.hourly.wind180];
  const dirs = [f.hourly.dir10, f.hourly.dir80, f.hourly.dir120, f.hourly.dir180];
  return LEVELS.flatMap((h, k) => {
    const s = speeds[k]![i];
    const d = dirs[k]![i];
    return s != null && d != null ? [{ heightM: h, speedMs: s, dirDeg: d }] : [];
  });
}

export function DroneMode() {
  const forecast = useForecast();
  const kp = useSpaceWeather();
  const gnss = useGnss();
  const now = useNow(60_000);
  const fmt = useFormat();
  const loc = useAppStore((s) => s.location);
  const drone = useAppStore((s) => s.drone);
  const setDrone = useAppStore((s) => s.setDrone);
  const profile = DRONE_PROFILES.find((p) => p.id === drone.profileId) ?? DRONE_PROFILES[0]!;
  const altOptions = fmt.units.height === "ft" ? ALT_FT : ALT_M;
  const altitudeM = snap(altOptions, drone.altitudeM);
  const f = forecast.data;

  const sky = gnss.data ?? null;
  const skyTimeline = gnss.data?.timeline;

  const kpSeries = kp.data?.series;
  const kpCurrent = kp.data?.current?.kp ?? null;
  const hours = useMemo(() => {
    if (!f) return [];
    const kpAt = (t: number) => {
      let best: number | null = null;
      for (const p of kpSeries ?? []) if (Date.parse(p.time) <= t) best = p.kp;
      return best ?? kpCurrent;
    };
    return hourRange(f, now, 24).idx.map((i) => {
      const t = f.hourly.time[i]! * 1000;
      const prof = profileAt(f, i);
      const atAlt = windAtHeight(prof, altitudeM);
      const gust = f.hourly.gust10[i] ?? 0;
      // Gusts scale up with height roughly like the mean wind does.
      const gustAtAlt = atAlt && prof[0] ? gust * Math.max(1, atAlt.speedMs / Math.max(0.5, prof[0].speedMs)) : gust;
      const ceiling = estimateCeiling({
        tempC: f.hourly.temp[i] ?? 15,
        dewPointC: f.hourly.dewPoint[i] ?? 5,
        lowPct: f.hourly.cloudLow[i] ?? 0,
        midPct: f.hourly.cloudMid[i] ?? 0,
        highPct: f.hourly.cloudHigh[i] ?? 0,
      });
      const tl = skyTimeline?.find((s) => Math.abs(s.time - t) < 1_800_000);
      const result = droneFlyability(
        {
          windAtAltitudeMs: atAlt?.speedMs ?? f.hourly.wind10[i] ?? 0,
          gustMs: gustAtAlt,
          precipProbPct: f.hourly.precipProb[i] ?? 0,
          precipMm: f.hourly.precip[i] ?? 0,
          visibilityM: f.hourly.visibility[i] ?? null,
          ceilingM: ceiling.baseM,
          flightAltitudeM: altitudeM,
          tempC: f.hourly.temp[i] ?? 15,
          kp: kpAt(t),
          skyPhase: skyPhase(sunPosition(new Date(t + 1_800_000), loc.lat, loc.lon).altitude),
          satellitesVisible: tl?.count ?? null,
        },
        profile,
      );
      return { i, t, prof, atAlt, gustAtAlt, ceiling, result };
    });
  }, [f, now, altitudeM, profile, kpSeries, kpCurrent, skyTimeline, loc.lat, loc.lon]);

  if (forecast.error && !f) return <ErrorNote error={forecast.error} what="the forecast" />;
  if (!f || !hours.length) return <Skeleton className="h-96" />;

  const cur = hours[0]!;
  const shear = cur.prof.length >= 3 ? bulkShear(cur.prof[0]!, cur.prof.find((p) => p.heightM === 120) ?? cur.prof[cur.prof.length - 1]!) : null;
  const hourFmt = fmtIn(f.timezone, { hour: "numeric" });
  const verdict: Record<ScoreResult["status"], string> = { go: "Good to fly", caution: "Fly with caution", "no-go": "Grounded" };
  const best = (() => {
    let run: typeof hours = [];
    let bestRun: typeof hours = [];
    for (const h of hours) {
      if (h.result.status === "go") run.push(h);
      else run = [];
      if (run.length > bestRun.length) bestRun = [...run];
    }
    return bestRun;
  })();
  const kpNow = kp.data?.current?.kp ?? null;
  const da = f.current.surfacePressure != null && f.current.temp != null ? densityAltitudeM(f.current.surfacePressure, f.current.temp) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <GlassCard className="lg:col-span-5" eyebrow="UAV flyability · now" title={`${profile.name} at ${fmt.height(altitudeM)} AGL`}>
        <div className="flex flex-wrap items-center gap-5">
          <ScoreRing value={cur.result.score} color={statusColor(cur.result.status)} label="Flyability score">
            <div>
              <p className="text-4xl font-semibold">{cur.result.score}</p>
              <p className="text-[10px] tracking-wide text-ink-3 uppercase">of 100</p>
            </div>
          </ScoreRing>
          <div className="min-w-0 flex-1 space-y-2">
            <StatusBadge status={cur.result.status} label={verdict[cur.result.status]} />
            <p className="text-sm text-ink-2">
              Wind at altitude <span className="font-semibold text-ink">{fmt.wind(cur.atAlt?.speedMs)}</span>
              {cur.atAlt && <> from {compassPoint(cur.atAlt.dirDeg)}</>}, gusts to <span className="font-semibold text-ink">{fmt.wind(cur.gustAtAlt)}</span>.
            </p>
            <p className="text-xs text-ink-3">
              {best.length ? `Best window: ${hourFmt.format(best[0]!.t)}–${hourFmt.format(best[best.length - 1]!.t + 3_600_000)}` : "No fully green window in the next 24 h"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-3">
            Airframe
            <select value={profile.id} onChange={(e) => setDrone({ profileId: e.target.value })} className="mt-1 w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm text-ink ring-1 ring-white/10 outline-none">
              {DRONE_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {fmt.wind(p.maxWindMs)}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-ink-3">
            Flight altitude
            <Segmented
              ariaLabel="Flight altitude"
              size="sm"
              className="mt-1"
              value={altitudeM}
              onChange={(altitudeM) => setDrone({ altitudeM })}
              options={altOptions.map((m) => ({ value: m, label: fmt.height(m) }))}
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard className="lg:col-span-7" eyebrow="Why" title="Factor breakdown">
        <ul className="grid gap-2 sm:grid-cols-2">
          {cur.result.factors.map((fa) => (
            <li key={fa.key} className="flex items-start justify-between gap-3 rounded-2xl bg-white/[0.035] px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{fa.label}</span>
                <span className="block text-xs text-ink-3">{fa.detail}</span>
              </span>
              <StatusBadge status={fa.status} />
            </li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard className="lg:col-span-12" eyebrow="Next 24 hours" title="Flight windows">
        <ol className="grid grid-cols-12 gap-1 sm:grid-cols-24" aria-label="Hourly flight status">
          {hours.map((h) => (
            <li key={h.i} className="flex flex-col items-center gap-1" title={`${hourFmt.format(h.t)} — ${verdict[h.result.status]} (${h.result.score})`}>
              <span className="h-10 w-full rounded-md" style={{ background: statusColor(h.result.status), opacity: 0.35 + (h.result.score / 100) * 0.65 }} />
              <span className="text-[10px] text-ink-3">{hourFmt.format(h.t)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-2">
          <StatusBadge status="go" label="Go" />
          <StatusBadge status="caution" label="Caution" />
          <StatusBadge status="no-go" label="No-go" />
          <span className="text-ink-3">Opacity = score within status.</span>
        </div>
      </GlassCard>

      <GlassCard className="lg:col-span-7" eyebrow="Winds aloft" title={`Wind at ${fmt.height(altitudeM)} vs. airframe limit`}>
        <TimeSeriesChart
          ariaLabel="Wind and gust at flight altitude, next 24 hours"
          times={hours.map((h) => h.t)}
          height={190}
          timeZone={f.timezone}
          yDomain={[0, null]}
          thresholds={[{ value: convertWind(profile.maxWindMs, fmt.units.wind), label: `Limit ${fmt.wind(profile.maxWindMs)}` }]}
          series={[
            { key: "w", label: "Wind at altitude", color: "var(--color-series-1)", values: hours.map((h) => (h.atAlt ? convertWind(h.atAlt.speedMs, fmt.units.wind) : null)), kind: "area", format: (v) => `${Math.round(v)}` },
            { key: "g", label: "Gust", color: "var(--color-series-2)", values: hours.map((h) => convertWind(h.gustAtAlt, fmt.units.wind)), dashed: true, format: (v) => `${Math.round(v)}` },
          ]}
        />
      </GlassCard>

      <GlassCard className="lg:col-span-5" eyebrow="Vertical profile · now" title="Low-level wind & shear">
        <ul className="space-y-2.5">
          {cur.prof.map((p, k) => {
            const max = Math.max(profile.maxWindMs, ...cur.prof.map((x) => x.speedMs));
            return (
              <li key={p.heightM} className="grid grid-cols-[3.5rem_1fr_4.5rem_1.5rem] items-center gap-2 text-xs">
                <span className="text-ink-3 tabular">{fmt.height(p.heightM)}</span>
                <span className="h-2.5 rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full" style={{ width: `${(p.speedMs / max) * 100}%`, background: LEVEL_COLORS[LEVELS.indexOf(p.heightM as (typeof LEVELS)[number])] ?? LEVEL_COLORS[k] }} />
                </span>
                <span className="text-right font-semibold text-ink tabular">{fmt.wind(p.speedMs)}</span>
                <span className="inline-block text-ink-2" style={{ transform: `rotate(${(p.dirDeg + 180) % 360}deg)` }} aria-label={`from ${compassPoint(p.dirDeg)}`}>
                  ↑
                </span>
              </li>
            );
          })}
        </ul>
        {shear && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Bulk shear" value={fmt.wind(shear.deltaMs)} sub="10 m → 120 m" />
            <Stat label="Per 100 m" value={fmt.wind(shear.per100m)} sub={shear.classification} />
            <Stat label="Veer" value={`${shear.veerDeg > 0 ? "+" : ""}${Math.round(shear.veerDeg)}°`} sub={shear.veerDeg >= 0 ? "veering" : "backing"} />
          </div>
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-4" eyebrow="Space weather · NOAA SWPC" title="Planetary Kp index">
        {kp.error ? (
          <ErrorNote error={kp.error} what="Kp data" />
        ) : (
          <>
            <div className="flex items-end gap-3">
              <p className="text-5xl font-semibold tabular">{kpNow != null ? kpNow.toFixed(1) : "—"}</p>
              {kpNow != null && <StatusBadge status={kpNow >= 7 ? "no-go" : kpNow >= 5 ? "caution" : "go"} label={kpNow >= 5 ? `G${Math.min(5, Math.floor(kpNow) - 4)} storm` : kpNow >= 4 ? "Active" : "Quiet"} />}
            </div>
            <p className="mt-1 text-xs text-ink-3">Next 24 h max: {kp.data?.maxNext24h?.toFixed(1) ?? "—"} · Kp ≥ 5 degrades GNSS accuracy and magnetometer heading.</p>
            <div className="mt-3">
              <TimeSeriesChart
                ariaLabel="Kp index, past and forecast"
                times={(kp.data?.series ?? []).map((p) => Date.parse(p.time))}
                height={110}
                yDomain={[0, 9]}
                now={now}
                thresholds={[{ value: 5, label: "G1", color: "var(--color-caution)" }]}
                series={[{ key: "kp", label: "Kp", color: "var(--color-series-1)", values: (kp.data?.series ?? []).map((p) => p.kp), kind: "bar", format: (v) => v.toFixed(1) }]}
              />
            </div>
          </>
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-5" eyebrow="GNSS · SGP4 from CelesTrak" title="Satellite visibility">
        {gnss.error ? (
          <ErrorNote error={gnss.error} what="satellite elements" />
        ) : !sky ? (
          <Skeleton className="h-56" />
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <SkyPlot sats={sky.sats} size={200} />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="In view" value={sky.count} sub="above 10° mask" />
                <Stat label="PDOP" value={sky.dop ? sky.dop.pdop.toFixed(1) : "—"} sub={sky.dop ? `HDOP ${sky.dop.hdop.toFixed(1)}` : undefined} />
              </div>
              <ul className="space-y-1 text-xs" aria-label="Legend">
                {CONSTELLATIONS.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-ink-2">
                    <svg width={12} height={12} aria-hidden>
                      <Marker shape={CONSTELLATION_STYLE[c].shape} x={6} y={6} r={4} color={CONSTELLATION_STYLE[c].color} />
                    </svg>
                    <span className="flex-1">{c}</span>
                    <span className="font-semibold text-ink tabular">{sky.byConstellation[c]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-3" eyebrow="Airspace & air mass" title="Ceiling & visibility">
        <div className="grid gap-3">
          <Stat
            label="Est. cloud ceiling"
            value={cur.ceiling.baseM != null ? fmt.height(cur.ceiling.baseM) : "Unlimited"}
            sub={cur.ceiling.baseM != null ? `${cur.ceiling.layer} layer · ${Math.round(cur.ceiling.coverPct)}% cover` : "No BKN/OVC layer"}
          />
          <Stat label="Visibility" value={fmt.visibility(f.hourly.visibility[cur.i])} sub="Part 107 min 3 SM" />
          <Stat label="Density altitude" value={da != null ? fmt.height(da) : "—"} sub="affects lift & battery" />
        </div>
        <p className={cn("mt-3 text-[11px] text-ink-3")}>Always check airspace (LAANC / B4UFLY) and NOTAMs before flight.</p>
      </GlassCard>
    </div>
  );
}
