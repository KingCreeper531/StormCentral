"use client";

import { Droplets, Eye, Gauge, Sun, Wind } from "lucide-react";
import type { AirQuality, Forecast } from "@/lib/api/open-meteo";
import { moonIllumination } from "@/lib/astro/moon";
import { compassPoint } from "@/lib/geo";
import { usAqiCategory } from "@/lib/science/air";
import { tendencyAt } from "@/lib/science/pressure";
import { currentHourIndex, fmtIn, todayIndex } from "@/lib/weather/view";
import { useFormat } from "@/hooks/use-format";
import { MoonDisc, SunArc, WindCompass } from "../ui/dials";
import { GlassCard } from "../ui/glass-card";

function Tile({ icon, label, children, className }: { icon?: React.ReactNode; label: string; children: React.ReactNode; className?: string }) {
  return (
    <GlassCard className={className} padded>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
        {icon}
        {label}
      </p>
      {children}
    </GlassCard>
  );
}

function uvLabel(uv: number) {
  return uv < 3 ? "Low" : uv < 6 ? "Moderate" : uv < 8 ? "High" : uv < 11 ? "Very high" : "Extreme";
}

export function DetailsGrid({ f, air, now }: { f: Forecast; air: AirQuality | undefined; now: number }) {
  const fmt = useFormat();
  const i = currentHourIndex(f, now);
  const d = todayIndex(f, now);
  const c = f.current;
  const tz = f.timezone;
  const timeFmt = fmtIn(tz, { hour: "numeric", minute: "2-digit" });
  const tendency = tendencyAt(f.hourly.pressureMsl, i);
  const uv = f.hourly.uv[i] ?? 0;
  const sunrise = f.daily.sunrise[d];
  const sunset = f.daily.sunset[d];
  const progress = sunrise && sunset ? (now / 1000 - sunrise) / (sunset - sunrise) : null;
  const moon = moonIllumination(new Date(now));
  const ai = air ? air.hourly.time.findIndex((t) => t * 1000 > now - 3_600_000) : -1;
  const aqi = ai >= 0 ? air!.hourly.usAqi[ai] : null;
  const cat = usAqiCategory(aqi);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile icon={<Wind className="size-3.5" />} label="Wind" className="col-span-2">
        <div className="flex items-center gap-5">
          <WindCompass dirDeg={c.windDir} size={96} label={`Wind from ${c.windDir != null ? compassPoint(c.windDir) : "unknown"}`} />
          <div>
            <p className="text-2xl font-semibold whitespace-nowrap">{fmt.wind(c.windSpeed)}</p>
            <p className="text-xs text-ink-2">from {c.windDir != null ? compassPoint(c.windDir) : "—"}</p>
            <p className="mt-2 text-xs text-ink-3">Gusts {fmt.wind(c.windGust)}</p>
          </div>
        </div>
      </Tile>
      <Tile icon={<Droplets className="size-3.5" />} label="Humidity">
        <p className="text-2xl font-semibold">{fmt.percent(c.rh)}</p>
        <p className="mt-1 text-xs text-ink-2">Dew point {fmt.temp(f.hourly.dewPoint[i])}</p>
        <div className="mt-3 h-1.5 rounded-full bg-sky-400/15">
          <div className="h-full rounded-full bg-sky-400" style={{ width: `${c.rh ?? 0}%` }} />
        </div>
      </Tile>
      <Tile icon={<Gauge className="size-3.5" />} label="Pressure">
        <p className="text-2xl font-semibold">{fmt.pressure(c.pressureMsl)}</p>
        <p className="mt-1 text-xs text-ink-2">{tendency ? `${tendency.term[0]!.toUpperCase()}${tendency.term.slice(1)} · ${fmt.pressureDelta(tendency.delta3h)} / 3 h` : "—"}</p>
      </Tile>
      <Tile icon={<Sun className="size-3.5" />} label="UV index">
        <p className="text-2xl font-semibold">
          {Math.round(uv)} <span className="text-sm font-medium text-ink-2">{uvLabel(uv)}</span>
        </p>
        <div className="relative mt-3 h-1.5 rounded-full" style={{ background: "linear-gradient(90deg,#22c55e,#eab308,#f97316,#ef4444,#a855f7)" }}>
          <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-black" style={{ left: `${Math.min(100, (uv / 11) * 100)}%` }} />
        </div>
      </Tile>
      <Tile icon={<Eye className="size-3.5" />} label="Visibility">
        <p className="text-2xl font-semibold">{fmt.visibility(f.hourly.visibility[i])}</p>
        <p className="mt-1 text-xs text-ink-2">Cloud cover {fmt.percent(c.cloud)}</p>
      </Tile>
      <Tile label="Air quality">
        <p className="text-2xl font-semibold">{aqi != null ? Math.round(aqi) : "—"}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
          {cat && <span className="size-2 rounded-full" style={{ background: cat.color }} />}
          {cat?.label ?? "US AQI"}
        </p>
      </Tile>
      <Tile label="Moon">
        <div className="flex items-center gap-3">
          <MoonDisc fraction={moon.fraction} waxing={moon.waxing} size={52} />
          <div>
            <p className="text-sm font-semibold">{moon.name}</p>
            <p className="text-xs text-ink-2">{Math.round(moon.fraction * 100)}% lit</p>
          </div>
        </div>
      </Tile>
      <Tile label="Precipitation" className="col-span-2">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold">{fmt.precip(f.daily.precipSum[d])}</p>
            <p className="mt-1 text-xs text-ink-2">expected today · {fmt.percent(f.daily.precipProbMax[d])} chance</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">{fmt.precip(f.daily.precipSum[d + 1])}</p>
            <p className="text-xs text-ink-3">tomorrow</p>
          </div>
        </div>
      </Tile>
      <Tile label="Sun" className="col-span-2">
        <SunArc progress={progress} width={220} />
        <div className="mt-1 flex justify-between text-xs text-ink-2">
          <span>↑ {sunrise ? timeFmt.format(sunrise * 1000) : "—"}</span>
          <span>↓ {sunset ? timeFmt.format(sunset * 1000) : "—"}</span>
        </div>
      </Tile>
    </div>
  );
}
