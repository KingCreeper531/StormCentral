"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson, HttpError } from "@/lib/api/http";
import type { Forecast } from "@/lib/api/open-meteo";
import type { GoogleWeather } from "@/lib/google-weather";
import { IS_STATIC_BUNDLE } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { fmtIn, todayIndex } from "@/lib/weather/view";
import { iconName } from "@/lib/weather/wmo";
import { useFormat } from "@/hooks/use-format";
import { Panel } from "../ui/panel";
import { WeatherIcon } from "../ui/weather-icon";

type Result = { kind: "ok"; data: GoogleWeather } | { kind: "off" } | { kind: "limit" };

async function load(lat: number, lon: number, signal: AbortSignal): Promise<Result> {
  try {
    return { kind: "ok", data: await getJson<GoogleWeather>(`/api/google-weather?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`, { signal }) };
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) return { kind: "off" };
    if (err instanceof HttpError && err.status === 429) return { kind: "limit" };
    throw err;
  }
}

/**
 * Google's AI weather forecast (Google Maps Platform Weather API) next to the
 * main forecast. Hidden when the server has no Google key.
 */
export function GoogleForecastPanel({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const q = useQuery({
    queryKey: ["google-weather", Math.round(f.lat * 10) / 10, Math.round(f.lon * 10) / 10],
    queryFn: ({ signal }) => load(f.lat, f.lon, signal),
    enabled: !IS_STATIC_BUNDLE,
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: 1,
  });
  if (!q.data || q.data.kind === "off") return null;
  if (q.data.kind === "limit") {
    return (
      <Panel title="Google AI forecast" className={className}>
        <p className="text-sm text-ink-3">This month&apos;s free Google forecast allowance is used up. It comes back on the 1st.</p>
      </Panel>
    );
  }
  const g = q.data.data;
  const tz = g.timeZone ?? f.timezone;
  const hourFmt = fmtIn(tz, { hour: "numeric" });
  const dayFmt = fmtIn("UTC", { weekday: "short" });
  const hours = g.hours.filter((h) => Date.parse(h.time) + 3_600_000 > now).slice(0, 12);
  const di = todayIndex(f, now);
  const today = g.days[0];
  const c = g.current;

  return (
    <Panel title="Google AI forecast" subtitle="Google's weather models, for comparison" className={className}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {c && (
          <div className="flex items-center gap-3">
            <WeatherIcon name={iconName(c.code, c.isDay)} size={44} label={c.text ?? undefined} />
            <div>
              <p className="text-2xl font-light text-ink tabular">{fmt.temp(c.tempC)}</p>
              <p className="text-xs text-ink-2">{c.text ?? "—"}</p>
            </div>
          </div>
        )}
        {c && (
          <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-xs">
            <dt className="label">Feels like</dt>
            <dt className="label">Rain</dt>
            <dt className="label">Thunder</dt>
            <dd className="text-ink tabular">{fmt.temp(c.feelsC)}</dd>
            <dd className="text-ink tabular">{fmt.percent(c.precipChance)}</dd>
            <dd className="text-ink tabular">{fmt.percent(c.thunderChance)}</dd>
          </dl>
        )}
        {today && (
          <p className="text-xs text-ink-3">
            Today: Google {fmt.temp(today.hiC)}/{fmt.temp(today.loC)}, Open-Meteo {fmt.temp(f.daily.tMax[di])}/{fmt.temp(f.daily.tMin[di])}
          </p>
        )}
      </div>

      {hours.length > 0 && (
        <ol className="-mx-4 mt-4 flex overflow-x-auto border-t border-line px-4 pt-3 sm:-mx-5 sm:px-5 [&::-webkit-scrollbar]:hidden" aria-label="Google hourly forecast">
          {hours.map((h, i) => (
            <li key={h.time} className="flex w-14 shrink-0 flex-col items-center gap-1">
              <span className="text-[11px] text-ink-3 tabular">{i === 0 ? "Now" : hourFmt.format(Date.parse(h.time))}</span>
              <WeatherIcon name={iconName(h.code, h.isDay)} size={28} animated={false} label={h.text ?? undefined} />
              <span className="text-[13px] text-ink tabular">{fmt.temp(h.tempC)}</span>
              <span className={cn("text-[11px] tabular", (h.precipChance ?? 0) >= 30 ? "text-accent" : "text-ink-3")}>{fmt.percent(h.precipChance)}</span>
            </li>
          ))}
        </ol>
      )}

      {g.days.length > 0 && (
        <ol className="-mx-4 mt-3 flex overflow-x-auto border-t border-line px-4 pt-3 sm:-mx-5 sm:px-5 [&::-webkit-scrollbar]:hidden" aria-label="Google 10-day forecast">
          {g.days.map((d, i) => (
            <li key={d.date} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <span className="text-[11px] text-ink-3">{i === 0 ? "Today" : dayFmt.format(Date.parse(`${d.date}T12:00:00Z`))}</span>
              <WeatherIcon name={iconName(d.code, true)} size={28} animated={false} label={d.text ?? undefined} />
              <span className="text-[12px] text-ink tabular">
                {fmt.temp(d.hiC)}
                <span className="text-ink-3">/{fmt.temp(d.loC)}</span>
              </span>
              <span className={cn("text-[11px] tabular", (d.precipChance ?? 0) >= 30 ? "text-accent" : "text-ink-3")}>{fmt.percent(d.precipChance)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="label mt-3">Forecast by Google Weather. Refreshed about hourly.</p>
    </Panel>
  );
}
