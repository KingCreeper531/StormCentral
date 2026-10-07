"use client";

import { motion } from "motion/react";
import type { Forecast } from "@/lib/api/open-meteo";
import { describeCode, iconName } from "@/lib/weather/wmo";
import { todayIndex } from "@/lib/weather/view";
import { useFormat } from "@/hooks/use-format";
import { useAppStore } from "@/store/app-store";
import { WeatherIcon } from "../ui/weather-icon";

export function CurrentHero({ f, now }: { f: Forecast; now: number }) {
  const fmt = useFormat();
  const name = useAppStore((s) => s.location.name);
  const c = f.current;
  const d = todayIndex(f, now);
  const info = describeCode(c.code);
  const icon = iconName(c.code, c.isDay === 1, { gustMs: c.windGust ?? undefined });
  const updated = Math.max(0, Math.round((now - f.fetchedAt) / 60_000));

  return (
    <section className="relative flex items-start justify-between gap-4 py-4 sm:items-end" aria-label="Current conditions">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-2">{name}</p>
        <div className="mt-1 flex items-start">
          <motion.span
            key={Math.round(c.temp ?? 0)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[6.5rem] leading-[0.85] font-extralight tracking-[-0.06em] text-ink sm:text-[9rem]"
          >
            {fmt.temp(c.temp)}
          </motion.span>
        </div>
        <p className="mt-3 text-xl font-medium text-ink">{info.label}</p>
        <p className="mt-1 text-sm text-ink-2">
          Feels like {fmt.temp(c.feelsLike)} · H {fmt.temp(f.daily.tMax[d])} · L {fmt.temp(f.daily.tMin[d])}
        </p>
        <p className="mt-1 text-xs text-ink-3">Updated {updated === 0 ? "just now" : `${updated} min ago`} · Open-Meteo</p>
      </div>
      <WeatherIcon name={icon} size={220} fluid label={info.label} className="-mr-2 w-32 shrink-0 drop-shadow-[0_20px_60px_rgba(0,0,0,.6)] sm:-mr-4 sm:w-56" />
    </section>
  );
}
