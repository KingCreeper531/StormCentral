import { cn } from "@/lib/utils";

/**
 * Linear meter: the fill carries the value, the track is a neutral step.
 * Optional tick marks show thresholds (e.g. AQI category bounds).
 */
export function Meter({
  value,
  max = 100,
  color,
  ticks = [],
  label,
  className,
}: {
  value: number;
  max?: number;
  color: string;
  ticks?: number[];
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-3", className)}
    >
      <div className="h-full rounded-[2px] transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      {ticks.map((t) => (
        <span key={t} className="absolute top-0 h-full w-px bg-canvas" style={{ left: `${(t / max) * 100}%` }} aria-hidden />
      ))}
    </div>
  );
}

/** Large tabular score with a meter underneath — replaces radial "score rings". */
export function ScoreReadout({
  score,
  max = 100,
  color,
  caption,
  label,
}: {
  score: number;
  max?: number;
  color: string;
  caption?: React.ReactNode;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-baseline gap-1.5">
        <span className="text-5xl font-light tracking-tight text-ink tabular">{Math.round(score)}</span>
        <span className="text-sm text-ink-3">/ {max}</span>
      </p>
      <Meter value={score} max={max} color={color} label={label} ticks={[25, 50, 75].map((t) => (t / 100) * max)} className="mt-2" />
      {caption && <div className="mt-2">{caption}</div>}
    </div>
  );
}
