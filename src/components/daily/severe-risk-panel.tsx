"use client";

import { Map as MapIcon } from "lucide-react";
import { useMemo } from "react";
import { useOutlook } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import type { OutlookFeature, OutlookKind, OutlookResponse } from "@/lib/api/types";
import { SPC_CATEGORICAL, SPC_PROB_STEPS, type SpcCategory, type SpcHazard } from "@/lib/feeds/parse";
import { geometryContains, type LatLon } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { clockIn, fmtIn } from "@/lib/weather/view";
import { useAppStore } from "@/store/app-store";
import { HATCH_SWATCH } from "../radar/outlook-legend";
import { Button } from "../ui/button";
import { Skeleton, Stat } from "../ui/misc";
import { Panel } from "../ui/panel";

const HAZARDS: { kind: SpcHazard; label: string }[] = [
  { kind: "tornado", label: "Tornado" },
  { kind: "hail", label: "Hail" },
  { kind: "wind", label: "Wind" },
];
/** MRGL…HIGH: the five numbered levels of the meter. */
const LEVELS = (Object.keys(SPC_CATEGORICAL) as SpcCategory[]).slice(1);

interface HazardAt {
  pct: number;
  fill: string | null;
  /** The hatched significant-severe feature over the point, if any. */
  significant: OutlookFeature | null;
}

/** Highest probability (and any significant area) containing the point. */
function hazardAt(features: OutlookFeature[], p: LatLon): HazardAt {
  const out: HazardAt = { pct: 0, fill: null, significant: null };
  for (const f of features) {
    if (!geometryContains(f.geometry, p)) continue;
    if (f.properties.significant) {
      out.significant ??= f;
      continue;
    }
    const n = Math.round(Number(f.properties.label) * 100);
    const pct = Number.isFinite(n) && n > 0 ? n : f.properties.rank;
    if (pct > out.pct) {
      out.pct = pct;
      out.fill = f.properties.fill;
    }
  }
  return out;
}

/** Highest categorical risk containing the point. */
function categoryAt(features: OutlookFeature[], p: LatLon): OutlookFeature | null {
  let best: OutlookFeature | null = null;
  for (const f of features) if ((!best || f.properties.rank > best.properties.rank) && geometryContains(f.geometry, p)) best = f;
  return best;
}

/**
 * The categorical level a probability implies on its own (SPC's conversion,
 * roughly), so "Show on map" opens the hazard driving the risk.
 */
function impliedLevel(kind: SpcHazard, pct: number): number {
  const steps = kind === "tornado" ? [2, 5, 10, 30, 45] : [5, 15, 30, 60, Infinity];
  return steps.filter((s) => pct >= s).length;
}

/** "7:00 AM", or "Thu 7:00 AM" when the outlook ends on another day there (Day 1 runs to 12Z tomorrow). */
function untilLabel(expires: string, now: number, timeZone?: string): string {
  const clock = clockIn(timeZone, expires);
  try {
    const date = fmtIn(timeZone, { year: "numeric", month: "numeric", day: "numeric" });
    if (date.format(new Date(expires)) === date.format(now)) return clock;
    return `${fmtIn(timeZone, { weekday: "short" }).format(new Date(expires))} ${clock}`;
  } catch {
    return clock; // unknown zone name: clockIn has already fallen back to the device clock
  }
}

/**
 * Today's SPC Day 1 severe outlook at the selected location: categorical level,
 * tornado / hail / wind probabilities, and a shortcut to the overlay on the
 * radar. Renders nothing outside any thunderstorm area or when SPC is unreachable.
 */
export function SevereRiskPanel({ className, timeZone }: { className?: string; timeZone?: string }) {
  const loc = useAppStore((s) => s.location);
  const setRadar = useAppStore((s) => s.setRadar);
  const setMode = useAppStore((s) => s.setMode);
  const now = useNow(60_000);
  const categorical = useOutlook(true, "categorical");
  const tornado = useOutlook(true, "tornado");
  const hail = useOutlook(true, "hail");
  const wind = useOutlook(true, "wind");
  const byHazard = { tornado, hail, wind };

  const cat = categorical.data;
  const torn = tornado.data;
  const hl = hail.data;
  const wnd = wind.data;
  const risk = useMemo(() => {
    const p = { lat: loc.lat, lon: loc.lon };
    const level = cat ? categoryAt(cat.features, p) : null;
    const hazards = {
      tornado: torn ? hazardAt(torn.features, p) : null,
      hail: hl ? hazardAt(hl.features, p) : null,
      wind: wnd ? hazardAt(wnd.features, p) : null,
    };
    // The response carries `expires` (see lib/feeds/outlook.ts) alongside the shared type.
    const expires = [cat, torn, hl, wnd]
      .map((d) => (d as (OutlookResponse & { expires?: string | null }) | undefined)?.expires)
      .find((e): e is string => typeof e === "string" && Number.isFinite(Date.parse(e)));
    return { level, hazards, expires: expires ?? null };
  }, [cat, torn, hl, wnd, loc.lat, loc.lon]);

  // Quiet failure: without the categorical outlook there is nothing to anchor the panel.
  if (categorical.isError && !cat) return null;
  const loading = [categorical, tornado, hail, wind].some((q) => q.data === undefined && !q.isError);
  if (loading)
    return (
      <Panel title="Severe weather outlook" subtitle="SPC Day 1" aria-busy="true" className={className}>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-3 h-1.5 w-full" />
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      </Panel>
    );

  const { level, hazards, expires } = risk;
  const anyProb = HAZARDS.some(({ kind }) => (hazards[kind]?.pct ?? 0) > 0 || hazards[kind]?.significant);
  if (!level && !anyProb) return null;

  const code = level && level.properties.label in SPC_CATEGORICAL ? (level.properties.label as SpcCategory) : null;
  const levelNum = code ? SPC_CATEGORICAL[code].rank - 1 : 0; // TSTM is 0: below the numbered levels
  const headline = code ? SPC_CATEGORICAL[code].name : "No severe risk";

  // The hazard implying the highest level opens on the map; ties go to tornado, then hail, then wind.
  let target: OutlookKind = "categorical";
  let best = 0;
  for (const { kind } of HAZARDS) {
    const h = hazards[kind];
    const score = h ? impliedLevel(kind, h.pct) * 2 + (h.significant ? 1 : 0) : 0;
    if (score > best) {
      best = score;
      target = kind;
    }
  }

  const until = expires ? untilLabel(expires, now, timeZone) : null;

  return (
    <Panel
      className={className}
      title="Severe weather outlook"
      subtitle={until ? `SPC Day 1, valid until ${until}` : "SPC Day 1"}
      action={
        <Button
          size="sm"
          onClick={() => {
            setRadar({ showOutlook: true, outlookKind: target });
            setMode("severe");
          }}
        >
          <MapIcon className="size-3.5" aria-hidden />
          Show on map
        </Button>
      }
    >
      <p className="text-lg font-medium text-ink">
        {headline}
        {levelNum > 0 && <span className="font-normal text-ink-3">, level {levelNum} of 5</span>}
      </p>
      {/* Five steps, each in SPC's colour for that level; unreached steps stay neutral. */}
      <div role="meter" aria-label="SPC risk level" aria-valuenow={levelNum} aria-valuemin={0} aria-valuemax={5} aria-valuetext={headline} className="mt-2 grid grid-cols-5 gap-1">
        {LEVELS.map((c, i) => (
          <span
            key={c}
            aria-hidden
            className={cn("h-1.5 rounded-[2px]", i >= levelNum && "bg-surface-3")}
            style={i < levelNum ? { background: SPC_CATEGORICAL[c].fill } : undefined}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
        {HAZARDS.map(({ kind, label }) => {
          const h = hazards[kind];
          const failed = !h && byHazard[kind].isError;
          const floor = SPC_PROB_STEPS[kind][0]!;
          return (
            <Stat
              key={kind}
              label={label}
              value={
                failed || !h ? (
                  "—"
                ) : h.pct > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    {h.fill && <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: h.fill }} />}
                    {h.pct}%
                  </span>
                ) : (
                  `<${floor}%`
                )
              }
              sub={
                failed ? (
                  "Unavailable"
                ) : h?.significant ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-[4px] border border-line px-1.5 py-px text-[11px] font-medium text-ink-2"
                    title={h.significant.properties.name}
                  >
                    <span aria-hidden className="size-2 shrink-0 rounded-[1px]" style={HATCH_SWATCH} />
                    <span aria-hidden>Significant</span>
                    <span className="sr-only">{h.significant.properties.name}</span>
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-3">Chance of each hazard within 25 miles of this location.</p>
    </Panel>
  );
}
