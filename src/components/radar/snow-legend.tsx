"use client";

import { useQuery } from "@tanstack/react-query";
import { useFormat } from "@/hooks/use-format";
import { getJson } from "@/lib/api/http";
import { useT } from "@/lib/i18n/use-t";
import { parseSnowLegend, snowLegendUrl, snowSource, snowThresholdLabel, type SnowMap, type SnowThreshold } from "@/lib/radar/snow";
import { cn } from "@/lib/utils";

const DAY: Record<Exclude<SnowMap, "off" | "depth">, number> = { day1: 1, day2: 2, day3: 3 };

/**
 * Key for the snow overlay. The map images come in the services' fixed
 * colours, so the swatches and labels are the services' own legend (read
 * once an hour; one answer covers every day and threshold); the threshold
 * in the title follows the person's units.
 * `card` (default) is a small map overlay like the outlook legend; `plain`
 * drops the overlay chrome for use inside the layer menu.
 */
export function SnowLegend({
  map,
  threshold,
  variant = "card",
  className,
}: {
  map: SnowMap;
  threshold: SnowThreshold;
  variant?: "card" | "plain";
  className?: string;
}) {
  const t = useT();
  const { units } = useFormat();
  const src = snowSource(map, threshold);
  const legend = useQuery({
    queryKey: ["snow-legend", src?.service],
    queryFn: ({ signal }) => getJson<unknown>(snowLegendUrl(src!), { signal, timeoutMs: 20_000 }),
    enabled: !!src,
    staleTime: 60 * 60_000,
    retry: 1,
  });
  if (!src || map === "off") return null;

  const depth = map === "depth";
  const items = legend.data ? parseSnowLegend(legend.data, src.layer) : [];
  // NOHRSC labels its depth key in inches.
  const title = depth ? t("Snow depth now, inches") : t("Chance of {amount} or more of snow", { amount: snowThresholdLabel(threshold, units.precip === "mm") });

  return (
    <div className={cn(variant === "card" && "overlay w-52 px-2.5 py-2 md:w-56", className)}>
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 font-medium text-ink">{title}</span>
        <span className="shrink-0 text-[11px] text-ink-3">{depth ? "NWS / NOHRSC" : "NWS / WPC"}</span>
      </p>

      {items.length ? (
        <ul className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-2 tabular">
          {items.map((it, i) => (
            <li key={`${i}-${it.label}`} className="flex items-center gap-1">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[2px] border border-line-strong bg-cover bg-center" style={{ backgroundImage: `url(${it.image})` }} />
              {it.label}
            </li>
          ))}
        </ul>
      ) : (
        legend.isError && <p className="mt-1 text-[11px] text-ink-3">{t("Key unavailable right now")}</p>
      )}

      <p className="mt-1.5 text-[11px] text-ink-3">
        {depth
          ? t("Modelled depth on the ground, updated daily")
          : t("In the 24 hours of WPC's Day {n}", { n: DAY[map] })}
      </p>
    </div>
  );
}
