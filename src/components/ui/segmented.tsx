"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Rectangular segmented control (radio group). No animated pill. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
  stretch = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel: string;
  /** Fill the container width with equal segments. */
  stretch?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5", stretch && "flex w-full", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[4px] font-medium whitespace-nowrap transition-colors disabled:opacity-35 pointer-coarse:min-h-10 pointer-coarse:min-w-11",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              stretch && "flex-1",
              active ? "bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-3 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
