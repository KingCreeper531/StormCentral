import { cn } from "@/lib/utils";

export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="label">{label}</p>
      <p className="mt-0.5 truncate text-lg font-medium text-ink tabular">{value}</p>
      {sub && <p className="truncate text-xs text-ink-3 tabular">{sub}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      {icon}
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="max-w-sm text-xs text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error, what }: { error: unknown; what: string }) {
  return (
    <p className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
      Couldn&apos;t load {what}. {error instanceof Error ? error.message : ""}
    </p>
  );
}

/**
 * Switch with its label. The whole row is the touch target (44 px tall on
 * touch screens); the track grows to 24×44 there so the state reads at a glance.
 */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-[13px] text-ink-2 pointer-coarse:min-h-11">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors pointer-coarse:h-6 pointer-coarse:w-11",
          checked ? "bg-accent" : "bg-surface-3",
        )}
      >
        {/* Anchored at the left edge: a button centres its content, so an unanchored knob starts mid-track. */}
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform pointer-coarse:size-5",
            checked ? "translate-x-4 pointer-coarse:translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </label>
  );
}

/** Profile picture, or an initial-letter avatar on a flat, user-specific hue. */
export function Avatar({ name, hue, size = 32, src }: { name: string; hue: number; size?: number; src?: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny same-origin image; next/image adds nothing here
    return <img src={src} alt="" aria-hidden width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white/90"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 35% 32%)` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Key–value row for dense lists (label left, value right, hairline between rows). */
export function Row({ label, value, sub, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2", className)}>
      <span className="min-w-0 text-[13px] text-ink-2">{label}</span>
      <span className="text-right">
        <span className="text-[13px] font-medium text-ink tabular">{value}</span>
        {sub && <span className="block text-xs text-ink-3 tabular">{sub}</span>}
      </span>
    </div>
  );
}
