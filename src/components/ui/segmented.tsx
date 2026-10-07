"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Segmented control with a spring-animated selection pill. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-full bg-white/[0.05] p-0.5 ring-1 ring-white/10", className)}>
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
              "relative rounded-full font-medium transition-colors disabled:opacity-35",
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs",
              active ? "text-black" : "text-ink-2 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
