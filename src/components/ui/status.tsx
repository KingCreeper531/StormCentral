import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import type { FactorStatus } from "@/lib/science/scores";
import { cn } from "@/lib/utils";

const MAP = {
  go: { label: "Go", icon: CircleCheck, cls: "text-go bg-go/12 ring-go/30" },
  caution: { label: "Caution", icon: CircleAlert, cls: "text-caution bg-caution/12 ring-caution/30" },
  "no-go": { label: "No-go", icon: CircleX, cls: "text-nogo bg-nogo/12 ring-nogo/35" },
} as const;

/** Status always ships as icon + label, never colour alone. */
export function StatusBadge({ status, label, className }: { status: FactorStatus; label?: string; className?: string }) {
  const m = MAP[status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", m.cls, className)}>
      <Icon className="size-3.5" aria-hidden />
      {label ?? m.label}
    </span>
  );
}

export function statusColor(status: FactorStatus) {
  return status === "go" ? "var(--color-go)" : status === "caution" ? "var(--color-caution)" : "var(--color-nogo)";
}
