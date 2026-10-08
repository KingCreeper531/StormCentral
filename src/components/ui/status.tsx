import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import type { FactorStatus } from "@/lib/science/scores";
import { cn } from "@/lib/utils";

const MAP = {
  go: { label: "Go", icon: CircleCheck, color: "var(--color-go)" },
  caution: { label: "Caution", icon: CircleAlert, color: "var(--color-caution)" },
  "no-go": { label: "No-go", icon: CircleX, color: "var(--color-nogo)" },
} as const;

/** Status = coloured icon + plain label. Never a filled pill, never colour alone. */
export function StatusText({ status, label, className }: { status: FactorStatus; label?: string; className?: string }) {
  const m = MAP[status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-ink", className)}>
      <Icon className="size-4 shrink-0" style={{ color: m.color }} aria-hidden />
      {label ?? m.label}
    </span>
  );
}

export function statusColor(status: FactorStatus) {
  return MAP[status].color;
}
