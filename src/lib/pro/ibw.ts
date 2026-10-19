/**
 * Impact-Based Warning (IBW) details for the hazard polygon inspector: the
 * damage-threat tier, how the threat was detected, the tagged hail and wind,
 * and the HAZARD / SOURCE / IMPACT paragraphs NWS puts in every IBW warning's
 * text.
 */
import type { WeatherAlert } from "../api/types";

export type IbwTier = "base" | "considerable" | "destructive" | "catastrophic";
export type IbwDetection = "radar indicated" | "observed" | "possible" | null;

export interface IbwDetails {
  tier: IbwTier;
  detection: IbwDetection;
  maxHail: string | null;
  maxWind: string | null;
  hazard: string | null;
  source: string | null;
  impact: string | null;
}

/** "HAZARD...Tornado and quarter size hail." (the paragraph may wrap onto following lines). */
export function ibwSection(text: string, key: "HAZARD" | "SOURCE" | "IMPACT"): string | null {
  const m = text.match(new RegExp(`(?:^|\\n)\\s*${key}\\.{3}([\\s\\S]*?)(?:\\n\\s*\\n|\\n\\s*[A-Z][A-Z ]{2,}\\.{3}|$)`));
  const v = m?.[1]?.replace(/\s+/g, " ").trim();
  return v || null;
}

export function ibwDetails(a: Pick<WeatherAlert, "tags" | "hazards" | "description">): IbwDetails {
  const tier: IbwTier =
    a.tags.includes("TORNADO EMERGENCY") || a.tags.includes("FLASH FLOOD EMERGENCY") || a.hazards.damageThreat === "CATASTROPHIC"
      ? "catastrophic"
      : a.tags.includes("DESTRUCTIVE") || a.hazards.damageThreat === "DESTRUCTIVE"
        ? "destructive"
        : a.tags.includes("PDS") || a.tags.includes("CONSIDERABLE") || a.hazards.damageThreat === "CONSIDERABLE"
          ? "considerable"
          : "base";
  const det = (a.hazards.tornado ?? "").toUpperCase();
  const detection: IbwDetection = det === "OBSERVED" ? "observed" : det === "POSSIBLE" ? "possible" : det.startsWith("RADAR") ? "radar indicated" : null;
  return {
    tier,
    detection,
    maxHail: a.hazards.maxHail && a.hazards.maxHail !== "0.00" ? a.hazards.maxHail : null,
    maxWind: a.hazards.maxWind ?? null,
    hazard: ibwSection(a.description, "HAZARD"),
    source: ibwSection(a.description, "SOURCE"),
    impact: ibwSection(a.description, "IMPACT"),
  };
}

/** Tier colours shared by the inspector badge and the polygon outline emphasis. */
export const TIER_COLOR: Record<IbwTier, string> = {
  base: "#94a3b8",
  considerable: "#f59e0b",
  destructive: "#ef4444",
  catastrophic: "#d946ef",
};
