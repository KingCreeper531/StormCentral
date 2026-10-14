"use client";

import { WifiOff } from "lucide-react";
import { motion } from "motion/react";
import type { Forecast } from "@/lib/api/open-meteo";
import { describeCode, iconName } from "@/lib/weather/wmo";
import { todayIndex } from "@/lib/weather/view";
import { forecastSource, isForecastSourceId } from "@/lib/forecast-sources";
import { useForecast } from "@/hooks/queries";
import { useT } from "@/lib/i18n/use-t";
import { useFormat } from "@/hooks/use-format";
import { useOnline } from "@/hooks/use-online";
import { fmtIn } from "@/lib/weather/view";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { WeatherIcon } from "../ui/weather-icon";

/**
 * Current conditions, set directly on the sky (no panel). The icon stays beside
 * the reading on wide screens. On short viewports (phones in landscape) it
 * compacts so the forecast panels start within the first screen.
 */
export function CurrentHero({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const t = useT();
  const fmt = useFormat();
  const name = useAppStore((s) => s.location.name);
  const c = f.current;
  const d = todayIndex(f, now);
  const info = describeCode(c.code);
  const icon = iconName(c.code, c.isDay === 1, { gustMs: c.windGust ?? undefined });
  const updated = Math.max(0, Math.round((now - f.fetchedAt) / 60_000));
  // No signal (a lake, a basement): the forecast saved on this device, labelled with when it was saved.
  const online = useOnline();
  const failed = useForecast().isError;
  const saved = !online || (failed && updated > 15);
  const savedAt = fmtIn(undefined, updated > 18 * 60 ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" }, t.locale).format(f.fetchedAt);
  const source = f.source && isForecastSourceId(f.source) ? t(forecastSource(f.source).short) : "Open-Meteo";

  const facts: [string, string][] = [
    [t("Feels like"), fmt.temp(c.feelsLike)],
    [t("High"), fmt.temp(f.daily.tMax[d])],
    [t("Low"), fmt.temp(f.daily.tMin[d])],
  ];

  return (
    <section
      aria-label={t("Current conditions")}
      className={cn(
        "flex min-w-0 items-start justify-between gap-3 py-1 sm:items-center sm:justify-start sm:gap-10 sm:py-3 [@media(max-height:500px)]:py-0",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-ink-2">{name === "My location" ? t(name) : name}</p>
        <motion.p
          key={Math.round(c.temp ?? 0)}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="mt-1 text-7xl leading-none font-light tracking-tight whitespace-nowrap text-ink tabular sm:text-8xl [@media(max-height:500px)]:text-6xl"
        >
          {fmt.temp(c.temp)}
        </motion.p>
        {/* Short viewports: the condition and the facts share one line. */}
        <div className="mt-3 [@media(max-height:500px)]:mt-1 [@media(max-height:500px)]:flex [@media(max-height:500px)]:flex-wrap [@media(max-height:500px)]:items-baseline [@media(max-height:500px)]:gap-x-4">
          <p className="text-lg font-medium text-ink">{t(info.label)}</p>
          <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm [@media(max-height:500px)]:mt-0">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1 whitespace-nowrap">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-medium text-ink tabular">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {saved ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-caution [@media(max-height:500px)]:mt-1">
            <WifiOff className="size-3.5" aria-hidden />
            {online
              ? t("Can't reach the forecast · showing the forecast saved at {time}", { time: savedAt })
              : t("Offline · showing the forecast saved at {time}", { time: savedAt })}
          </p>
        ) : (
          <p className="label mt-2 [@media(max-height:500px)]:mt-1">
            {updated === 0 ? t("Updated just now · {source}", { source }) : t("Updated {n} min ago · {source}", { n: updated, source })}
          </p>
        )}
      </div>
      <WeatherIcon name={icon} size={160} fluid label={t(info.label)} className="w-24 sm:w-32 [@media(max-height:500px)]:w-16" />
    </section>
  );
}
