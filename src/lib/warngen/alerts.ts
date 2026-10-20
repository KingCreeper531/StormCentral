/**
 * Spotter warnings shown through the same pipeline as NWS alerts (the map's
 * warning layer, selection, the alert detail panel), clearly marked as the
 * spotter network's own, unofficial products.
 */
import type { WeatherAlert } from "../api/types";
import { WARN_PRODUCTS } from "./products";
import type { SpotterWarningDto } from "./schema";
import { productName, warningText } from "./text";

/** NWS storm warnings outrank these on the map; they outrank watches and advisories. */
const SPOTTER_RANK = { TOR: 60, SVR: 52, FFW: 50, SQW: 46, SPS: 34 } as const;

export function spotterAlert(w: SpotterWarningDto, timeZone?: string): WeatherAlert {
  const iso = (t: number) => new Date(t).toISOString();
  const tags: string[] = [];
  if (w.kind === "TOR" && w.threat === "catastrophic") tags.push("TORNADO EMERGENCY");
  else if (w.kind === "TOR" && w.threat === "considerable") tags.push("PDS");
  if (w.kind === "FFW" && w.threat === "catastrophic") tags.push("FLASH FLOOD EMERGENCY");
  if (w.kind === "SVR" && w.threat !== "base") tags.push(w.threat.toUpperCase());
  if (w.kind === "SVR" && w.tornadoPossible) tags.push("TORNADO POSSIBLE");
  return {
    id: `spotter-${w.id}`,
    event: productName(w.kind),
    headline: `Unofficial: issued by @${w.issuer.username} to the StormCentral spotter network. Not a National Weather Service warning.`,
    severity: "Unknown",
    urgency: "Immediate",
    certainty: w.basis === "radar" ? "Likely" : "Observed",
    sent: iso(w.issuedAt),
    effective: iso(w.updatedAt),
    expires: iso(w.cancelledAt ?? w.expiresAt),
    ends: null,
    areaDesc: w.locations.join(", "),
    sender: `${w.issuer.displayName} (@${w.issuer.username}), spotter network`,
    description: warningText({ ...w, number: w.number, issuer: w.issuer }, { timeZone }),
    instruction: null,
    hazards: {
      maxHail: w.hail ? w.hail.toFixed(2) : undefined,
      maxWind: w.wind ? `${w.wind} MPH` : undefined,
      tornado: w.kind === "TOR" ? (w.basis === "radar" ? "RADAR INDICATED" : "OBSERVED") : w.tornadoPossible ? "POSSIBLE" : undefined,
    },
    tags,
    color: WARN_PRODUCTS[w.kind].color,
    rank: SPOTTER_RANK[w.kind],
    motion: w.motion && w.storm ? { headingDeg: w.motion.headingDeg, speedKt: Math.round(w.motion.speedKt), positions: [[w.storm.lon, w.storm.lat]], time: iso(w.storm.t) } : null,
    geometry: w.polygon.length >= 4 ? { type: "Polygon", coordinates: [w.polygon] } : null,
    source: "spotter",
    category: "warning",
  };
}
