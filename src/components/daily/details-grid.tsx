"use client";

import type { AirQuality, Forecast } from "@/lib/api/open-meteo";
import { moonIllumination } from "@/lib/astro/moon";
import { compassPoint } from "@/lib/geo";
import { usAqiCategory } from "@/lib/science/air";
import { tendencyAt } from "@/lib/science/pressure";
import { currentHourIndex, fmtIn, todayIndex } from "@/lib/weather/view";
import { useFormat } from "@/hooks/use-format";
import type { Translator } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { MoonDisc, SunArc, WindCompass } from "../ui/dials";
import { Meter } from "../ui/meter";
import { Stat } from "../ui/misc";
import { Panel } from "../ui/panel";

/** WHO / EPA UV index categories with their standard colours (data colouring). */
const UV_SCALE: { max: number; label: string; color: string }[] = [
  { max: 3, label: "Low", color: "#4eb400" },
  { max: 6, label: "Moderate", color: "#f7e400" },
  { max: 8, label: "High", color: "#f85900" },
  { max: 11, label: "Very high", color: "#d8001d" },
  { max: Number.POSITIVE_INFINITY, label: "Extreme", color: "#6b49c8" },
];

function uvCategory(uv: number) {
  return UV_SCALE.find((c) => uv < c.max) ?? UV_SCALE[UV_SCALE.length - 1]!;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** UV category in the display language: the lowercase level ids ("very high") read as sentence case. */
const uvLabel = (label: string, t: Translator) => sentence(t(label.toLowerCase()));

/** One cell of the conditions sheet: a hairline above, no nested card. */
function Cell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("min-w-0 border-t border-line pt-3", className)}>{children}</div>;
}

function Detail({ children }: { children: React.ReactNode }) {
  return <p className="truncate text-xs text-ink-3 tabular">{children}</p>;
}

/** Current conditions as a dense spec sheet: 2 columns on phones, 4 when wide. */
export function ConditionsPanel({ f, air, now, className }: { f: Forecast; air: AirQuality | undefined; now: number; className?: string }) {
  const t = useT();
  const fmt = useFormat();
  const i = currentHourIndex(f, now);
  const d = todayIndex(f, now);
  const c = f.current;
  const tendency = tendencyAt(f.hourly.pressureMsl, i);
  const uv = f.hourly.uv[i] ?? 0;
  const uvMax = f.daily.uvMax[d];
  const uvCat = uvCategory(uv);
  const ai = air ? air.hourly.time.findIndex((t) => t * 1000 > now - 3_600_000) : -1;
  const aqi = ai >= 0 ? air!.hourly.usAqi[ai] : null;
  const cat = usAqiCategory(aqi);
  const from = c.windDir != null ? t(compassPoint(c.windDir)) : null;

  return (
    <Panel title={t("Conditions")} className={className}>
      <div className="@container">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 @min-[30rem]:grid-cols-4">
          <Cell className="col-span-2 flex items-center gap-4">
            <WindCompass dirDeg={c.windDir} size={72} label={from ? t("Wind from {dir}", { dir: from }) : t("Wind direction unknown")} />
            <Stat label={t("Wind")} value={fmt.wind(c.windSpeed)} sub={t("From {dir}, gusts {gust}", { dir: from ?? "—", gust: fmt.wind(c.windGust) })} />
          </Cell>
          <Cell>
            <Stat label={t("Humidity")} value={fmt.percent(c.rh)} sub={t("Dew point {temp}", { temp: fmt.temp(f.hourly.dewPoint[i]) })} />
          </Cell>
          <Cell>
            <Stat label={t("Pressure")} value={fmt.pressure(c.pressureMsl)} sub={tendency ? sentence(t(tendency.term)) : "—"} />
            {tendency && <Detail>{t("{delta} in 3 h", { delta: fmt.pressureDelta(tendency.delta3h) })}</Detail>}
          </Cell>
          <Cell>
            <Stat
              label={t("UV index")}
              value={
                <>
                  {Math.round(uv)} <span className="text-sm font-normal text-ink-2">{uvLabel(uvCat.label, t)}</span>
                </>
              }
              sub={uvMax != null ? t("Max {n} today", { n: Math.round(uvMax) }) : undefined}
            />
            <Meter value={uv} max={11} color={uvCat.color} ticks={[3, 6, 8]} label={t("UV index")} className="mt-2" />
          </Cell>
          <Cell>
            <Stat label={t("Visibility")} value={fmt.visibility(f.hourly.visibility[i])} sub={t("Cloud cover {pct}", { pct: fmt.percent(c.cloud) })} />
          </Cell>
          <Cell>
            <Stat
              label={t("Air quality (US AQI)")}
              value={aqi != null ? Math.round(aqi) : "—"}
              sub={
                cat ? (
                  <>
                    <span className="mr-1.5 inline-block size-2 rounded-[2px] align-[0.05em]" style={{ background: cat.color }} aria-hidden />
                    {t(cat.label)}
                  </>
                ) : (
                  t("No data")
                )
              }
            />
          </Cell>
          <Cell>
            <Stat label={t("Precipitation today")} value={fmt.precip(f.daily.precipSum[d])} sub={t("{pct} chance", { pct: fmt.percent(f.daily.precipProbMax[d]) })} />
            <Detail>{t("Tomorrow {amount}", { amount: fmt.precip(f.daily.precipSum[d + 1]) })}</Detail>
          </Cell>
        </div>
      </div>
    </Panel>
  );
}

function daylight(sunrise: number | null | undefined, sunset: number | null | undefined, t: Translator) {
  if (!sunrise || !sunset || sunset <= sunrise) return undefined;
  const mins = Math.round((sunset - sunrise) / 60);
  return t("{h} h {m} min of daylight", { h: Math.floor(mins / 60), m: mins % 60 });
}

/** Sun path with sunrise/sunset, and the moon phase. */
export function SunMoonPanel({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const t = useT();
  const d = todayIndex(f, now);
  const timeFmt = fmtIn(f.timezone, { hour: "numeric", minute: "2-digit" }, t.locale);
  const sunrise = f.daily.sunrise[d];
  const sunset = f.daily.sunset[d];
  const progress = sunrise && sunset ? (now / 1000 - sunrise) / (sunset - sunrise) : null;
  const moon = moonIllumination(new Date(now));

  return (
    // Flex column so the body can centre itself when the desktop grid stretches the panel.
    <Panel title={t("Sun and moon")} subtitle={daylight(sunrise, sunset, t)} className={cn("flex flex-col", className)}>
      <div className="@container flex flex-1 flex-col justify-center">
        <div className="grid grid-cols-1 gap-4 @min-[30rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[30rem]:gap-6">
          {/* Sunrise/sunset share the arc's width so the labels sit under its ends. */}
          <div className="w-full max-w-[220px] min-w-0">
            <div className="[&_svg]:h-auto [&_svg]:w-full">
              <SunArc progress={progress} width={220} />
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <Stat label={t("Sunrise")} value={sunrise ? timeFmt.format(sunrise * 1000) : "—"} />
              <Stat label={t("Sunset")} value={sunset ? timeFmt.format(sunset * 1000) : "—"} className="text-right" />
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-4 border-t border-line pt-4 @min-[30rem]:border-t-0 @min-[30rem]:border-l @min-[30rem]:pt-0 @min-[30rem]:pl-6">
            <MoonDisc fraction={moon.fraction} waxing={moon.waxing} size={56} />
            <Stat label={t("Moon")} value={sentence(t(moon.name))} sub={t("{pct}% illuminated", { pct: Math.round(moon.fraction * 100) })} />
          </div>
        </div>
      </div>
    </Panel>
  );
}
