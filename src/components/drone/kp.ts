import { translator, type Translator } from "@/lib/i18n/core";
import type { FactorStatus } from "@/lib/science/scores";

/** Kp rounded to the one decimal the UI shows, so a status never disagrees with its number. */
export const roundKp = (kp: number) => Math.round(kp * 10) / 10;

/**
 * NOAA reading of a Kp value, judged on the displayed (rounded) value:
 * below 4 quiet, 4 active, 5+ a G1–G5 storm (caution), 7+ no-go.
 * `t`: language of the label; English when omitted.
 */
export function kpLevel(kp: number, t: Translator = translator("en")): { status: FactorStatus; label: string } {
  const v = roundKp(kp);
  if (v >= 5) return { status: v >= 7 ? "no-go" : "caution", label: t("G{g} storm", { g: Math.min(5, Math.floor(v) - 4) }) };
  return { status: "go", label: v >= 4 ? t("Active") : t("Quiet") };
}
