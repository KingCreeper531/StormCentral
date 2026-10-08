"use client";

import { useAppStore } from "@/store/app-store";
import { Segmented } from "../ui/segmented";

/** °F / °C switch. Inline in the top bar at lg+, and inside the account menu below that. */
export function UnitsToggle({ className, stretch }: { className?: string; stretch?: boolean }) {
  const units = useAppStore((s) => s.units);
  const setUnits = useAppStore((s) => s.setUnits);
  return (
    <Segmented
      ariaLabel="Temperature units"
      size="sm"
      stretch={stretch}
      value={units.temp}
      onChange={(v) => setUnits(v === "F" ? "imperial" : "metric")}
      options={[
        { value: "F", label: "°F" },
        { value: "C", label: "°C" },
      ]}
      className={className}
    />
  );
}
