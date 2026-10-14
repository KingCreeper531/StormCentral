"use client";

import { useFormat } from "@/hooks/use-format";
import type { TropicalStorm } from "@/lib/feeds/tropical";
import { stormTitle } from "@/lib/feeds/tropical-parse";
import { compassPoint } from "@/lib/geo";
import { translator, type Translator } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import type { Formatters } from "@/lib/weather/units";
import { clockIn } from "@/lib/weather/view";
import { EmptyState } from "../ui/misc";

/**
 * Intensity colours, chosen to read on the near-black basemap: depressions
 * blue, storms teal, Saffir-Simpson categories 1–5 yellow → red → magenta.
 * Post-tropical, remnant lows and disturbances are grey.
 */
const INTENSITY_COLORS: Record<string, string> = {
  TD: "#5aa9ff",
  SD: "#5aa9ff",
  TS: "#2fc7a5",
  SS: "#2fc7a5",
  H1: "#f2d43d",
  H2: "#f7a234",
  H3: "#f2652d",
  H4: "#e8304d",
  H5: "#e04fd0",
};
const OTHER_COLOR = "#9aa0a8";

export const intensityColor = (label: string | null | undefined) => (label && INTENSITY_COLORS[label]) || OTHER_COLOR;

const STAGE_NAMES: Record<string, string> = {
  TD: "Tropical depression",
  TS: "Tropical storm",
  SD: "Subtropical depression",
  SS: "Subtropical storm",
  PT: "Post-tropical",
  LO: "Remnant low",
  PC: "Potential cyclone",
  DB: "Disturbance",
};

/** "Category 3 hurricane" (`short`: "Cat 3 hurricane"), "Tropical storm", … in `t`'s language. */
export function intensityName(label: string | null | undefined, short = false, t: Translator = translator("en")): string | null {
  const cat = label?.match(/^H([1-5])$/)?.[1];
  if (cat) return t(short ? "Cat {n} hurricane" : "Category {n} hurricane", { n: cat });
  const stage = label && STAGE_NAMES[label];
  return stage ? t(stage) : null;
}

const KT_TO_MS = 0.514444;
const MPH_TO_MS = 0.44704;
export const ktToMs = (kt: number | null | undefined) => (kt == null ? null : kt * KT_TO_MS);

/** "NW at 12 mph" in the user's wind unit, "Stationary", or "—" (in `t`'s language). */
export function movementText({ towardDeg, speedMph }: TropicalStorm["movement"], fmt: Pick<Formatters, "wind">, t: Translator = translator("en")): string {
  if (speedMph === 0) return t("Stationary");
  if (towardDeg == null || speedMph == null) return "—";
  return t("{dir} at {speed}", { dir: t(compassPoint(towardDeg)), speed: fmt.wind(speedMph * MPH_TO_MS) });
}

/** "25.4° N, 80.1° W" (compass letters in `t`'s language). */
export function positionText(lat: number, lon: number, t: Translator = translator("en")): string {
  const lo = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(lat).toFixed(1)}° ${t(lat >= 0 ? "N" : "S")}, ${Math.abs(lo).toFixed(1)}° ${t(lo >= 0 ? "E" : "W")}`;
}

/** Intensity colour as an 8 px square swatch (the colour never stands alone: a label always accompanies it). */
export function IntensitySwatch({ label, className }: { label: string | null | undefined; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", className)} style={{ background: intensityColor(label) }} />;
}

/** Small outlined chip ("Cat 4"). */
export function TropicalTag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex shrink-0 items-center rounded-[4px] border border-line px-1.5 py-px text-[11px] leading-4 font-medium text-ink-2">{children}</span>;
}

/** Dense rows of active tropical cyclones: intensity, wind, pressure, motion and update time. */
export function TropicalList({
  storms,
  timeZone,
  selectedId,
  onSelect,
}: {
  storms: TropicalStorm[];
  /** IANA zone of the selected location; times use the device's zone when omitted. */
  timeZone: string | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const fmt = useFormat();
  const t = useT();
  if (!storms.length) {
    return (
      <EmptyState title={t("No active tropical cyclones")}>{t("The National Hurricane Center monitors the Atlantic and the eastern and central Pacific.")}</EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {storms.map((s) => {
        const selected = selectedId === s.id;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "flex w-full gap-2.5 border-l-2 py-2.5 pr-4 pl-3.5 text-left transition-colors",
                selected ? "border-accent bg-surface-2" : "border-transparent hover:bg-surface-2",
              )}
            >
              <IntensitySwatch label={s.label} className="mt-1.5" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="min-w-0 text-[13px] leading-5 font-semibold text-ink">{stormTitle(s.classification, s.name, t)}</span>
                  {s.category != null && <TropicalTag>{t("Cat {n}", { n: s.category })}</TropicalTag>}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2 tabular">
                  <span>{fmt.wind(ktToMs(s.windKt))}</span>
                  {s.pressureMb != null && <span>{fmt.pressure(s.pressureMb)}</span>}
                  <span>{movementText(s.movement, fmt, t)}</span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-ink-3 tabular">
                  <span className="min-w-0 truncate">{s.basin ? t(s.basin) : ""}</span>
                  {s.updated && <span className="shrink-0">{t("Updated {time}", { time: clockIn(timeZone, s.updated, t.locale) })}</span>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
