import { cn } from "@/lib/utils";

export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon}
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="max-w-sm text-xs text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error, what }: { error: unknown; what: string }) {
  return (
    <p className="rounded-xl bg-nogo/10 px-3 py-2 text-xs text-ink-2 ring-1 ring-nogo/25">
      Couldn&apos;t load {what}. {error instanceof Error ? error.message : ""}
    </p>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-xs text-ink-2">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-white/15")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

export function Avatar({ name, hue, size = 32 }: { name: string; hue: number; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white/90"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 50) % 360} 70% 30%))`,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
