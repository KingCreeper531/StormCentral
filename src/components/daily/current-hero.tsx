"use client";

import { motion } from "motion/react";
import type { Forecast } from "@/lib/api/open-meteo";
import { describeCode, iconName } from "@/lib/weather/wmo";
import { todayIndex } from "@/lib/weather/view";
import { useFormat } from "@/hooks/use-format";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { WeatherIcon } from "../ui/weather-icon";

/**
 * Current conditions, set directly on the sky (no panel). The icon stays beside
 * the reading on wide screens. On short viewports (phones in landscape) it
 * compacts so the forecast panels start within the first screen.
 */
export function CurrentHero({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const name = useAppStore((s) => s.location.name);
  const c = f.current;
  const d = todayIndex(f, now);
  const info = describeCode(c.code);
  const icon = iconName(c.code, c.isDay === 1, { gustMs: c.windGust ?? undefined });
  const updated = Math.max(0, Math.round((now - f.fetchedAt) / 60_000));

  const facts: [string, string][] = [
    ["Feels like", fmt.temp(c.feelsLike)],
    ["High", fmt.temp(f.daily.tMax[d])],
    ["Low", fmt.temp(f.daily.tMin[d])],
  ];

  return (
    <section
      aria-label="Current conditions"
      className={cn(
        "flex min-w-0 items-start justify-between gap-3 py-1 sm:items-center sm:justify-start sm:gap-10 sm:py-3 [@media(max-height:500px)]:py-0",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-ink-2">{name}</p>
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
          <p className="text-lg font-medium text-ink">{info.label}</p>
          <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm [@media(max-height:500px)]:mt-0">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1 whitespace-nowrap">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-medium text-ink tabular">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="label mt-2 [@media(max-height:500px)]:mt-1">
          Updated {updated === 0 ? "just now" : `${updated} min ago`} · Open-Meteo
        </p>
      </div>
      <WeatherIcon name={icon} size={160} fluid label={info.label} className="w-24 sm:w-32 [@media(max-height:500px)]:w-16" />
    </section>
  );
}
