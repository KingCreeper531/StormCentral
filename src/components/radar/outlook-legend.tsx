import type { OutlookFeature, OutlookKind } from "@/lib/api/types";
import { SPC_CATEGORICAL, type SpcCategory } from "@/lib/feeds/parse";
import { cn } from "@/lib/utils";

const TITLE: Record<OutlookKind, string> = {
  categorical: "Categorical risk",
  tornado: "Tornado probability",
  hail: "Hail probability",
  wind: "Wind probability",
};

/** Legend names: the 1–5 level number is shown beside them. */
const CATEGORY_LABEL: Record<SpcCategory, string> = {
  TSTM: "Thunderstorms",
  MRGL: "Marginal",
  SLGT: "Slight",
  ENH: "Enhanced",
  MDT: "Moderate",
  HIGH: "High",
};

/** CSS twin of the map's hatch ("/" diagonals, light line on a dark rim). Gradients are fine inside a data legend. */
export const HATCH_SWATCH: React.CSSProperties = {
  background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.85) 0 1px, rgba(0,0,0,0.55) 1px 3px)",
};

function Swatch({ color, hatched }: { color?: string; hatched?: boolean }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[2px] border border-line-strong"
      style={hatched ? HATCH_SWATCH : { background: color, borderColor: color }}
    />
  );
}

/**
 * Key for the SPC Day 1 outlook overlay.
 * - `categorical`: the six levels, TSTM to HIGH, with their 1–5 numbers.
 * - `tornado` / `hail` / `wind`: the probability steps on the map today, plus
 *   a hatched swatch when a significant-severe area is drawn.
 * `card` (default) is a small map overlay like the radar legend; `plain` drops
 * the overlay chrome for use inside a sheet or panel.
 */
export function OutlookLegend({
  kind,
  features,
  variant = "card",
  className,
}: {
  kind: OutlookKind;
  features: OutlookFeature[];
  variant?: "card" | "plain";
  className?: string;
}) {
  const probabilistic = kind !== "categorical";

  // Probability steps present today, with SPC's colours from the data.
  const steps = new Map<string, { pct: number; fill: string }>();
  let significant: OutlookFeature | undefined;
  if (probabilistic) {
    for (const f of features) {
      if (f.properties.significant) significant ??= f;
      else if (!steps.has(f.properties.label)) {
        const pct = Math.round(Number(f.properties.label) * 100);
        steps.set(f.properties.label, { pct: Number.isFinite(pct) ? pct : f.properties.rank, fill: f.properties.fill });
      }
    }
  }
  const probItems = [...steps.values()].sort((a, b) => a.pct - b.pct);

  // Categorical: the fixed scale, coloured from the data where present.
  const catFill = new Map(features.map((f) => [f.properties.label, f.properties.fill]));

  return (
    <div className={cn(variant === "card" && "overlay w-52 px-2.5 py-2 md:w-56", className)}>
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-ink">{TITLE[kind]}</span>
        <span className="shrink-0 text-[11px] text-ink-3">SPC Day 1</span>
      </p>

      {!probabilistic ? (
        <ul className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
          {(Object.keys(SPC_CATEGORICAL) as SpcCategory[]).map((code) => {
            const def = SPC_CATEGORICAL[code];
            const level = def.rank - 1;
            return (
              <li key={code} className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-2" title={def.name}>
                <Swatch color={catFill.get(code) ?? def.fill} />
                <span className="truncate">{CATEGORY_LABEL[code]}</span>
                {level > 0 && (
                  <span aria-hidden className="ml-auto shrink-0 text-ink-3 tabular">
                    {level}
                  </span>
                )}
                <span className="sr-only">{level > 0 ? `, level ${level} of 5` : ", below level 1"}</span>
              </li>
            );
          })}
        </ul>
      ) : probItems.length || significant ? (
        <ul className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-2 tabular">
          {probItems.map((s) => (
            <li key={s.pct} className="flex items-center gap-1">
              <Swatch color={s.fill} />
              {s.pct}%
            </li>
          ))}
          {significant && (
            <li className="flex items-center gap-1" title={significant.properties.name}>
              <Swatch hatched />
              Significant
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] text-ink-3">No risk areas today</p>
      )}

      {probabilistic && <p className="mt-1.5 text-[11px] text-ink-3">Chance within 25 miles of a point</p>}
    </div>
  );
}
