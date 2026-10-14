"use client";

import { Map as MapIcon } from "lucide-react";
import { useIncomingStorms } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { compassPoint } from "@/lib/geo";
import type { Translator } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/use-t";
import type { IncomingStorm } from "@/lib/storm-eta";
import { roundMinutes } from "@/lib/weather/rain-outlook";
import { fmtIn } from "@/lib/weather/view";
import { useAppStore } from "@/store/app-store";
import { CELL_COLORS } from "../map/layers/storm-cells-layer";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";

/** What the radar sees in the cell, most serious first. */
function stormLabel(s: IncomingStorm, t: Translator): string {
  if (s.tvs) return t("Storm with rotation (tornado vortex signature)");
  if (s.level >= 3) return t("Rotating storm (mesocyclone)");
  if (s.level === 2) return t("Storm with severe hail");
  if (s.level === 1) return t("Storm with hail or weak rotation");
  return t("Strong thunderstorm");
}

/**
 * Daily page: radar storm cells due to reach the selected location within
 * the hour, with arrival time, hail and motion. Renders nothing when none are.
 */
export function IncomingStormsPanel() {
  const t = useT();
  const { data } = useIncomingStorms();
  const fmt = useFormat();
  const setMode = useAppStore((s) => s.setMode);
  const storms = data?.storms ?? [];
  if (!storms.length) return null;
  const first = storms[0]!;
  const clock = fmtIn(undefined, { hour: "numeric", minute: "2-digit" }, t.locale);
  const title =
    storms.length === 1
      ? t("Storm arriving around {time}", { time: clock.format(first.arrivesAt) })
      : t("{n} storms heading your way, first around {time}", { n: storms.length, time: clock.format(first.arrivesAt) });
  return (
    <Panel
      title={<span className="whitespace-normal">{title}</span>}
      subtitle={t("From radar storm tracking; follow official warnings")}
      action={
        <Button size="sm" variant="ghost" onClick={() => setMode("severe")}>
          <MapIcon className="size-4" aria-hidden />
          {t("Radar")}
        </Button>
      }
      className="border-caution/40"
    >
      <ul className="-mx-1 divide-y divide-line">
        {storms.map((s) => {
          const color = s.level > 0 ? CELL_COLORS[s.level] : "var(--color-ink-3)";
          const details = [
            s.maxHailIn && s.maxHailIn >= 0.5 ? t("hail up to {size}", { size: fmt.precip(s.maxHailIn * 25.4) }) : null,
            s.speedKt >= 3 ? t("moving {dir} at {speed}", { dir: t(compassPoint(s.headingDeg)), speed: fmt.wind(s.speedKt / 1.943844) }) : null,
            t("{distance} away", { distance: fmt.distanceKm(s.distanceKm) }),
          ].filter(Boolean);
          return (
            <li key={s.id} className="flex items-center gap-3 px-1 py-2.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{stormLabel(s, t)}</span>
                <span className="block text-xs text-ink-3">{details.join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold text-ink tabular">{clock.format(s.arrivesAt)}</span>
                <span className="block text-xs text-ink-3 tabular">{t("in {n} min", { n: roundMinutes(Math.max(1, s.etaMin)) })}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
