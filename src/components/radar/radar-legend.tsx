import { FAMILIES, legendGradient, type ProductFamily } from "@/lib/radar/products";
import { cn } from "@/lib/utils";

const HC_CLASSES = [
  { code: "BIO", name: "Biological / clutter" },
  { code: "IC", name: "Ice crystals" },
  { code: "DS", name: "Dry snow" },
  { code: "WS", name: "Wet snow" },
  { code: "RA", name: "Light to moderate rain" },
  { code: "HR", name: "Heavy rain" },
  { code: "BD", name: "Big drops" },
  { code: "GR", name: "Graupel" },
  { code: "HA", name: "Hail" },
];

/** "Storm-Relative Velocity" → "Storm-relative velocity". */
export const sentenceCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Colour scale for the active radar product.
 * - `card` (default): a small map overlay with the product name, scale and an
 *   optional source caption (site and product code).
 * - `strip`: one full-width row (code, min, gradient, max) for the top of the
 *   phone transport box.
 * - `inline`: the same row with a fixed-width gradient, for the end of a
 *   transport row on short screens.
 * `strip` and `inline` are unstyled rows that sit inside another overlay.
 */
export function RadarLegend({
  family,
  caption,
  code,
  variant = "card",
  className,
}: {
  family: ProductFamily;
  caption?: React.ReactNode;
  /** Product code shown at the start of `strip` / `inline` rows ("N0Q", "KTLX N0B"). */
  code?: string;
  variant?: "card" | "strip" | "inline";
  className?: string;
}) {
  const def = FAMILIES[family];
  const stops = def.legend;
  const mid = stops[Math.floor(stops.length / 2)]!;
  const label = sentenceCase(def.label);

  const hcItems = stops.map((s, i) => (
    <li key={s.value} className="flex items-center gap-1 font-mono text-[11px] text-ink-2" title={HC_CLASSES[i]?.name}>
      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
      {HC_CLASSES[i]?.code}
      <span className="sr-only">{HC_CLASSES[i]?.name}</span>
    </li>
  ));

  if (variant !== "card") {
    return (
      <div className={cn("flex min-w-0 items-center gap-2 text-[11px] leading-4 text-ink-3 tabular", variant === "strip" && "px-2.5 pt-2", className)}>
        {code && <span className="shrink-0 font-mono text-ink-2">{code}</span>}
        <span className="sr-only">{label}</span>
        {family === "hc" ? (
          <ul className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5", variant === "strip" ? "flex-1" : "max-w-60")}>{hcItems}</ul>
        ) : (
          <>
            <span className="shrink-0">{stops[0]!.value}</span>
            <span
              aria-hidden
              className={cn("h-1.5 rounded-[2px]", variant === "strip" ? "min-w-0 flex-1" : "w-20 shrink-0")}
              style={{ background: legendGradient(stops) }}
            />
            <span className="shrink-0">
              {stops[stops.length - 1]!.value} <span className="font-mono">{def.unit}</span>
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("overlay w-48 px-2.5 py-2 md:w-56", className)}>
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-ink">{label}</span>
        {family !== "hc" && <span className="shrink-0 font-mono text-[11px] text-ink-3">{def.unit}</span>}
      </p>

      {family === "hc" ? (
        <ul className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1 [&>li]:gap-1.5">{hcItems}</ul>
      ) : (
        <>
          {/* Data legend: the gradient is the colour scale itself. */}
          <div className="mt-1.5 h-1.5 rounded-[2px]" style={{ background: legendGradient(stops) }} aria-hidden />
          <div className="mt-1 flex justify-between text-[11px] text-ink-3 tabular">
            <span>{stops[0]!.value}</span>
            <span>{mid.value}</span>
            <span>{stops[stops.length - 1]!.value}</span>
          </div>
        </>
      )}

      {caption && <div className="mt-1.5 flex min-w-0 items-baseline justify-between gap-2 border-t border-line pt-1.5 text-xs text-ink-3">{caption}</div>}
    </div>
  );
}
