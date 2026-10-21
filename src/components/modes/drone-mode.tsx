"use client";

import { ArrowUp, ChevronDown } from "lucide-react";
import { Fragment, useId, useMemo } from "react";
import { densityAltitudeM } from "@/lib/science/atmosphere";
import { DRONE_PROFILES } from "@/lib/science/scores";
import { bulkShear } from "@/lib/science/wind";
import { convertWind } from "@/lib/weather/units";
import { flyabilityAt, WIND_LEVELS } from "@/lib/weather/hourly-scores";
import { fmtIn, hourRange } from "@/lib/weather/view";
import { compassPoint } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { useForecast, useGnss, useSpaceWeather } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { TimeSeriesChart, type SeriesDef } from "../charts/time-series";
import { FlightWindows, VERDICT } from "../drone/flight-windows";
import { kpLevel, roundKp } from "../drone/kp";
import { CONSTELLATION_STYLE, CONSTELLATIONS, Marker, SkyPlot } from "../drone/sky-plot";
import { ScoreReadout } from "../ui/meter";
import { ErrorNote, Skeleton, Stat } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";
import { StatusText, statusColor } from "../ui/status";

const LEVELS = WIND_LEVELS;
const LEVEL_COLORS = ["#9ec5f4", "#6da7ec", "#3987e5", "#256abf"]; // validated ordinal ramp

// 100–400 ft (Part 107 ceiling) or 30–120 m (EU Open category); stored in metres
// and snapped to the nearest option so labels and maths always agree.
const ALT_FT: readonly number[] = [100, 200, 300, 400].map((ft) => ft / 3.28084);
const ALT_M: readonly number[] = [30, 60, 90, 120];
const snap = (options: readonly number[], v: number) => options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A translated template with React nodes in its `{placeholders}` (styled values inside a sentence). */
function rich(text: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/\{(\w+)\}/g).map((s, i) => (i % 2 ? <Fragment key={i}>{parts[s] ?? `{${s}}`}</Fragment> : s));
}

/**
 * Phones: one column in reading order (verdict, factors, hourly windows,
 * winds aloft, profile, Kp, GNSS, ceiling). Desktop: a 12-column grid with
 * the verdict and its factors side by side.
 */
export function DroneMode() {
  const t = useT();
  const forecast = useForecast();
  const kp = useSpaceWeather();
  const gnss = useGnss();
  const now = useNow(60_000);
  const fmt = useFormat();
  // lg: panels share rows and stretch to their tallest neighbour.
  const wide = useMediaQuery("(min-width: 1024px)");
  const airframeHintId = useId();
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
    const kpAt = (at: number) => {
      let best: number | null = null;
      for (const p of kpSeries ?? []) if (Date.parse(p.time) <= at) best = p.kp;
      return best ?? kpCurrent;
    };
    return hourRange(f, now, 24).idx.map((i, k) => {
      const time = f.hourly.time[i]! * 1000;
      // Hour 0 uses the same current reading the Kp panel shows, rounded like the display.
      const kpRaw = k === 0 && kpCurrent != null ? kpCurrent : kpAt(time);
      const kpHour = kpRaw != null ? roundKp(kpRaw) : null;
      const tl = skyTimeline?.find((s) => Math.abs(s.time - time) < 1_800_000);
      const { prof, atAlt, gustAtAlt, ceiling, result: scored } = flyabilityAt(f, i, {
        altitudeM,
        profile,
        lat: loc.lat,
        lon: loc.lon,
        kp: kpHour,
        satellitesVisible: tl?.count ?? null,
        t,
      });
      // Describe Kp with the same words as the Kp panel (the status already agrees:
      // both use the 5 / 7 thresholds on the rounded value).
      // Cloud clearance in the user's height unit (the scorer works in metres).
      const clearance = ceiling.baseM != null ? ceiling.baseM - altitudeM : null;
      const result = {
        ...scored,
        factors: scored.factors.map((fa) =>
          fa.key === "kp" && kpHour != null
            ? { ...fa, detail: `${kpLevel(kpHour, t).label} (Kp ${kpHour.toFixed(1)})` }
            : fa.key === "ceiling" && clearance != null && fa.status !== "no-go"
              ? { ...fa, detail: t("{height} below base", { height: fmt.height(clearance) }) }
              : fa,
        ),
      };
      return { i, t: time, prof, atAlt, gustAtAlt, ceiling, result };
    });
  }, [f, now, altitudeM, profile, kpSeries, kpCurrent, skyTimeline, loc.lat, loc.lon, fmt, t]);

  if (forecast.error && !f) return <ErrorNote error={forecast.error} what="the forecast" />;
  if (!f || !hours.length)
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-busy="true">
        <Skeleton className="h-64 lg:col-span-5" />
        <Skeleton className="h-64 lg:col-span-7" />
        <Skeleton className="h-36 lg:col-span-12" />
        <Skeleton className="h-64 lg:col-span-7" />
        <Skeleton className="h-64 lg:col-span-5" />
      </div>
    );

  const cur = hours[0]!;
  const shear = cur.prof.length >= 3 ? bulkShear(cur.prof[0]!, cur.prof.find((p) => p.heightM === 120) ?? cur.prof[cur.prof.length - 1]!) : null;
  const hourFmt = fmtIn(f.timezone, { hour: "numeric" }, t.locale);
  const profileName = t(profile.name);
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
  const kpNow = kpCurrent;
  const kpNowLevel = kpNow != null ? kpLevel(kpNow, t) : null;
  const kpBars: SeriesDef & { colorFor?: (v: number) => string } = {
    key: "kp",
    label: "Kp",
    color: "var(--color-series-1)",
    values: (kpSeries ?? []).map((p) => p.kp),
    kind: "bar",
    format: (v) => v.toFixed(1),
    axisFormat: (v) => String(Math.round(v)),
    // Storm-level bars take their status colour (G1–G2 caution, G3+ no-go).
    colorFor: (v) => {
      const { status } = kpLevel(v);
      return status === "go" ? "var(--color-series-1)" : statusColor(status);
    },
  };
  const da = f.current.surfacePressure != null && f.current.temp != null ? densityAltitudeM(f.current.surfacePressure, f.current.temp) : null;
  const profileMax = Math.max(profile.maxWindMs, ...cur.prof.map((x) => x.speedMs));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Panel title={t("Flight conditions")} subtitle={t("{profile} at {height} AGL", { profile: profileName, height: fmt.height(altitudeM) })} className="flex flex-col lg:col-span-5">
        <div className="@container flex flex-1 flex-col">
          <div className="mb-4 grid grid-cols-1 gap-4 @min-[22rem]:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] @min-[22rem]:gap-6">
            <ScoreReadout
              score={cur.result.score}
              color={statusColor(cur.result.status)}
              label={t("Flyability score")}
              caption={<StatusText status={cur.result.status} label={t(VERDICT[cur.result.status])} />}
            />
            <div className="min-w-0 space-y-3">
              <p className="text-sm text-ink-2">
                {rich(
                  cur.atAlt
                    ? t("Wind at altitude {wind} from {dir}, gusts to {gust}.", { dir: t(compassPoint(cur.atAlt.dirDeg)) })
                    : t("Wind at altitude {wind}, gusts to {gust}."),
                  {
                    wind: <span className="font-medium text-ink tabular">{fmt.wind(cur.atAlt?.speedMs)}</span>,
                    gust: <span className="font-medium text-ink tabular">{fmt.wind(cur.gustAtAlt)}</span>,
                  },
                )}
              </p>
              {best.length ? (
                <Stat
                  label={t("Best window")}
                  value={`${hourFmt.format(best[0]!.t)}–${hourFmt.format(best[best.length - 1]!.t + 3_600_000)}`}
                  sub={t("{n} h of go conditions", { n: best.length })}
                />
              ) : (
                <Stat label={t("Best window")} value={t("No window")} sub={t("No go hours in the next 24 h")} />
              )}
            </div>
          </div>

          <div className="mt-auto grid grid-cols-1 gap-3 border-t border-line pt-4 @min-[32.5rem]:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <label className="block">
                <span className="label mb-1.5 block">{t("Airframe")}</span>
                <span className="relative block">
                  <select
                    value={profile.id}
                    onChange={(e) => setDrone({ profileId: e.target.value })}
                    aria-describedby={airframeHintId}
                    className="h-9 w-full appearance-none truncate rounded-[var(--radius-control)] border border-line bg-surface-2 pr-8 pl-3 text-sm text-ink outline-none focus:border-accent pointer-coarse:h-11"
                  >
                    {DRONE_PROFILES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t(p.name)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                </span>
              </label>
              <p id={airframeHintId} className="label mt-1">
                {t("Wind limit {wind}", { wind: fmt.wind(profile.maxWindMs) })}
              </p>
            </div>
            <div className="min-w-0">
              <p className="label mb-1.5">{t("Flight altitude")}</p>
              <Segmented
                ariaLabel={t("Flight altitude")}
                stretch
                value={altitudeM}
                onChange={(altitudeM) => setDrone({ altitudeM })}
                options={altOptions.map((m) => ({ value: m, label: fmt.height(m) }))}
              />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title={t("Factors")} subtitle={t("What sets the score this hour")} className="lg:col-span-7">
        <div className="@container">
          <ul className="grid grid-cols-1 @min-[30rem]:grid-cols-2 @min-[30rem]:gap-x-6">
            {cur.result.factors.map((fa) => (
              <li
                key={fa.key}
                className="flex items-start justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0 @min-[30rem]:nth-2:border-t-0 @min-[30rem]:nth-2:pt-0"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{fa.label}</span>
                  <span className="block text-xs text-ink-3">{fa.detail}</span>
                </span>
                <StatusText status={fa.status} className="shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <FlightWindows hours={hours} timeZone={f.timezone} className="lg:col-span-12" />

      <Panel title={t("Winds aloft")} subtitle={t("{height} AGL against the {profile} limit", { height: fmt.height(altitudeM), profile: profileName })} className="lg:col-span-7">
        <TimeSeriesChart
          ariaLabel={t("Wind and gust at flight altitude, next 24 hours")}
          times={hours.map((h) => h.t)}
          height={190}
          timeZone={f.timezone}
          yDomain={[0, null]}
          thresholds={[{ value: convertWind(profile.maxWindMs, fmt.units.wind), label: t("Limit {wind}", { wind: fmt.wind(profile.maxWindMs) }) }]}
          series={[
            { key: "w", label: t("Wind at altitude"), color: "var(--color-series-1)", values: hours.map((h) => (h.atAlt ? convertWind(h.atAlt.speedMs, fmt.units.wind) : null)), kind: "area", format: (v) => `${Math.round(v)}` },
            { key: "g", label: t("Gust"), color: "var(--color-series-2)", values: hours.map((h) => (h.gustAtAlt != null ? convertWind(h.gustAtAlt, fmt.units.wind) : null)), dashed: true, format: (v) => `${Math.round(v)}` },
          ]}
        />
      </Panel>

      <Panel title={t("Vertical profile")} subtitle={t("Low-level wind and shear, now")} className="lg:col-span-5">
        <ul aria-label={t("Wind by height")} className="divide-y divide-line">
          {cur.prof.map((p, k) => (
            <li key={p.heightM} className="grid grid-cols-[3.25rem_minmax(0,1fr)_4.25rem_3.25rem] items-center gap-2.5 py-2 text-[13px] first:pt-0">
              <span className="text-ink-3 tabular">{fmt.height(p.heightM)}</span>
              <span className="relative h-2 rounded-[2px] bg-surface-3">
                <span
                  className="block h-full rounded-[2px]"
                  style={{ width: `${(p.speedMs / profileMax) * 100}%`, background: LEVEL_COLORS[LEVELS.indexOf(p.heightM as (typeof LEVELS)[number])] ?? LEVEL_COLORS[k] }}
                />
                <span aria-hidden className="absolute -inset-y-1 -ml-px w-px bg-nogo" style={{ left: `${(profile.maxWindMs / profileMax) * 100}%` }} />
              </span>
              <span className="text-right font-medium text-ink tabular">{fmt.wind(p.speedMs)}</span>
              <span className="flex items-center gap-1 text-ink-2">
                <ArrowUp className="size-3.5 shrink-0" style={{ transform: `rotate(${(p.dirDeg + 180) % 360}deg)` }} aria-hidden />
                <span>
                  <span className="sr-only">{t("From {dir}", { dir: t(compassPoint(p.dirDeg)) })}</span>
                  <span aria-hidden>{t(compassPoint(p.dirDeg))}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="label mt-2">
          {t("The red line marks the {profile} limit of {wind}. Arrows point downwind.", { profile: profileName, wind: fmt.wind(profile.maxWindMs) })}
        </p>
        {shear && (
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
            <Stat label={t("Bulk shear")} value={fmt.wind(shear.deltaMs)} sub={`${fmt.height(10, false)}–${fmt.height(120)}`} />
            {fmt.units.height === "ft" ? (
              <Stat label={t("Per 100 ft")} value={fmt.wind(shear.per100m * 0.3048)} sub={sentence(t(shear.classification))} />
            ) : (
              <Stat label={t("Per 100 m")} value={fmt.wind(shear.per100m)} sub={sentence(t(shear.classification))} />
            )}
            <Stat label={t("Veer")} value={`${shear.veerDeg > 0 ? "+" : ""}${Math.round(shear.veerDeg)}°`} sub={shear.veerDeg >= 0 ? t("Veering") : t("Backing")} />
          </div>
        )}
      </Panel>

      <Panel title={t("Planetary K-index")} subtitle={t("NOAA SWPC, observed and forecast")} className="flex flex-col lg:col-span-4">
        {kp.error ? (
          <ErrorNote error={kp.error} what="the Kp data" />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="label">{t("Now")}</p>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-3xl font-light text-ink tabular">{kpNow != null ? kpNow.toFixed(1) : "—"}</span>
                  {kpNowLevel && <StatusText status={kpNowLevel.status} label={kpNowLevel.label} />}
                </p>
              </div>
              <Stat label={t("Next 24 h max")} value={kp.data?.maxNext24h?.toFixed(1) ?? "—"} className="shrink-0 text-right" />
            </div>
            <div className="mt-3 flex-1">
              {kp.data ? (
                <TimeSeriesChart
                  ariaLabel={t("Kp index, past and forecast")}
                  times={(kpSeries ?? []).map((p) => Date.parse(p.time))}
                  height={wide ? 150 : 110}
                  timeZone={f.timezone}
                  yDomain={[0, 9]}
                  now={now}
                  thresholds={[{ value: 5, label: "G1", color: "var(--color-caution)" }]}
                  series={[kpBars]}
                />
              ) : (
                <Skeleton className="h-[110px] lg:h-[150px]" />
              )}
            </div>
            <p className="mt-3 text-xs text-ink-3">{t("Kp 5 or higher degrades GNSS accuracy and magnetometer heading.")}</p>
          </>
        )}
      </Panel>

      <Panel title={t("Satellite visibility")} subtitle={t("GNSS, SGP4 from CelesTrak elements")} className="lg:col-span-5">
        {gnss.error ? (
          <ErrorNote error={gnss.error} what="the satellite elements" />
        ) : !sky ? (
          <Skeleton className="h-56" />
        ) : (
          <div className="@container">
            <div className="grid grid-cols-1 items-center gap-4 @min-[26rem]:grid-cols-[minmax(0,200px)_minmax(0,1fr)] @min-[26rem]:gap-5">
              <SkyPlot sats={sky.sats} size={200} className="mx-auto" />
              <div className="min-w-0">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label={t("In view")} value={sky.count} sub={t("Above 10° mask")} />
                  <Stat label="PDOP" value={sky.dop ? sky.dop.pdop.toFixed(1) : "—"} sub={sky.dop ? `HDOP ${sky.dop.hdop.toFixed(1)}` : undefined} />
                </div>
                <ul className="mt-3 divide-y divide-line border-t border-line" aria-label={t("Satellites by constellation")}>
                  {CONSTELLATIONS.map((c) => (
                    <li key={c} className="flex items-center gap-2 py-1.5 text-[13px]">
                      <svg width={12} height={12} className="shrink-0" aria-hidden>
                        <Marker shape={CONSTELLATION_STYLE[c].shape} x={6} y={6} r={4} color={CONSTELLATION_STYLE[c].color} />
                      </svg>
                      <span className="min-w-0 flex-1 text-ink-2">{c}</span>
                      <span className="font-medium text-ink tabular">{sky.byConstellation[c]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel title={t("Ceiling and visibility")} subtitle={t("Current hour")} className="flex flex-col lg:col-span-3">
        <div className="mb-4 grid grid-cols-3 gap-3 lg:grid-cols-1 lg:gap-4">
          <Stat
            label={t("Ceiling (est.)")}
            value={cur.ceiling.baseM != null ? fmt.height(cur.ceiling.baseM) : t("Unlimited")}
            sub={cur.ceiling.baseM != null ? t("{pct}% {layer} cover", { pct: Math.round(cur.ceiling.coverPct), layer: t(cur.ceiling.layer) }) : t("No BKN/OVC")}
          />
          <Stat label={t("Visibility")} value={fmt.visibility(f.hourly.visibility[cur.i])} sub={t("3 SM minimum")} />
          <Stat label={t("Density altitude")} value={da != null ? fmt.height(da) : "—"} sub={t("Lift and battery")} />
        </div>
        <p className="mt-auto border-t border-line pt-3 text-xs text-ink-3">{t("Check airspace (LAANC or B4UFLY) and NOTAMs before every flight.")}</p>
      </Panel>
    </div>
  );
}
