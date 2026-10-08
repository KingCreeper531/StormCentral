"use client";

import { useMemo } from "react";
import { formatters } from "@/lib/weather/units";
import { useAppStore } from "@/store/app-store";

export function useFormat() {
  const units = useAppStore((s) => s.units);
  return useMemo(() => ({ ...formatters(units), units }), [units]);
}
