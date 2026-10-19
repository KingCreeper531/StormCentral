"use client";

import { Check } from "lucide-react";
import { ALERT_CATEGORIES, type AlertCategory } from "@/lib/alerts";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import type { RadarSettings } from "@/store/app-store";

export const ALERT_KIND_LABEL: Record<AlertCategory, string> = {
  warning: "Other warnings",
  watch: "Watches",
  advisory: "Advisories",
  statement: "Statements",
  marine: "Marine",
  discussion: "SPC/WPC discussions",
};

/** Swatch colour per chip: a typical product of each kind. */
const KIND_SWATCH: Record<AlertCategory, string> = {
  warning: "#ff69b4",
  watch: "#ffff00",
  advisory: "#7b68ee",
  statement: "#ffe4b5",
  marine: "#d8bfd8",
  discussion: "#2f6bff",
};

/**
 * Which hazard-map polygons the radar maps draw next to storm-based
 * warnings, plus other countries' warnings. Chips, so all seven fit in a
 * narrow panel.
 */
export function AlertKindsPicker({ settings, onChange, compact = false }: { settings: Pick<RadarSettings, "alertKinds" | "intlAlerts">; onChange: (r: Partial<RadarSettings>) => void; compact?: boolean }) {
  const t = useT();
  const on = new Set(settings.alertKinds);
  const toggle = (k: AlertCategory) => onChange({ alertKinds: ALERT_CATEGORIES.filter((c) => (c === k ? !on.has(c) : on.has(c))) });
  const chip = (checked: boolean, label: string, swatch: string, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors pointer-coarse:h-9",
        compact ? "h-6" : "h-7",
        checked ? "border-line-strong bg-surface-3 text-ink" : "border-line bg-transparent text-ink-3 hover:text-ink",
      )}
    >
      <span aria-hidden className="size-2.5 shrink-0 rounded-[2px] border border-black/30" style={{ background: checked ? swatch : "transparent" }} />
      {label}
      {checked && <Check className="size-3 text-ink-3" aria-hidden />}
    </button>
  );
  return (
    <div role="group" aria-label={t("Hazard polygons")} className="flex flex-wrap gap-1.5">
      {ALERT_CATEGORIES.map((k) => chip(on.has(k), t(ALERT_KIND_LABEL[k]), KIND_SWATCH[k], () => toggle(k), k))}
      {chip(settings.intlAlerts, t("Canada & Germany"), "#dc2626", () => onChange({ intlAlerts: !settings.intlAlerts }), "intl")}
    </div>
  );
}
