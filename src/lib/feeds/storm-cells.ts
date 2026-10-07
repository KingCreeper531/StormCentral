import { HttpError } from "../api/http";
import type { Feed } from "./types";

/** One NEXRAD storm cell (SCIT/hail/meso attributes) from the latest volume scan. */
export interface StormCell {
  /** `${radar}-${stormId}` */
  id: string;
  /** WSR-88D id, e.g. "TLX". */
  radar: string;
  /** Two-character SCIT id, e.g. "A3". */
  stormId: string;
  lat: number;
  lon: number;
  /** ISO time of the volume scan (UTC). */
  time: string;
  /** Probability of hail of any size, % (POH). */
  hailProb: number | null;
  /** Probability of severe hail ≥ 1", % (POSH). */
  severeHailProb: number | null;
  /** Maximum expected hail size, inches. */
  maxHailIn: number | null;
  /** Mesocyclone strength rank (higher is stronger), null when none. */
  meso: number | null;
  /** Tornado vortex signature: "TVS", "ETVS" (elevated) or null. */
  tvs: "TVS" | "ETVS" | null;
  /** Vertically integrated liquid, kg/m². */
  vil: number | null;
  maxDbz: number | null;
  /** Echo top, thousands of feet. */
  topKft: number | null;
  /** Cell motion; `fromDeg` uses the meteorological convention (direction it comes from). */
  motion: { fromDeg: number; speedKt: number } | null;
}

export interface StormCellsResponse {
  cells: StormCell[];
  updated: string;
}

/** Latest storm-cell attributes from every NEXRAD (Iowa Environmental Mesonet). */
export const stormCellsFeed: Feed<StormCellsResponse> = {
  path: "/api/storm-cells",
  maxAge: 120,
  async load() {
    throw new HttpError("Storm cells aren't implemented yet", 501);
  },
};
