"use client";

import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Small count shown after the label. */
  count?: number;
}

/** Underline tabs: text-only, accent rule under the active tab. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex gap-4", className)}>
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "relative -mb-px flex h-10 items-center gap-1.5 border-b-2 text-[13px] font-medium whitespace-nowrap transition-colors",
              active ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && <span className="text-xs text-ink-3 tabular">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
