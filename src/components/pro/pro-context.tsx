"use client";

import { createContext, useContext } from "react";
import type { ValueScale } from "@/lib/pro/scales";
import type { ProSync } from "@/lib/pro/sync";
import type { LatLon } from "@/lib/geo";
import type { RadarFrame } from "@/lib/radar/frames";
import type { ProductFamily } from "@/lib/radar/products";

/** What the cursor readout needs from a pane to sample it. */
export interface PaneProbe {
  /** "P1 REF 0.5°". */
  label: string;
  family: ProductFamily | null;
  /** The frame on screen right now (follows the loop clock). */
  frame: () => RadarFrame | null;
  zoom: () => number;
  scale: (frame: RadarFrame) => ValueScale | null;
}

/** Map clicks routed to the analysis tools. */
export interface ToolActions {
  sounding: (p: LatLon) => void;
  xsect: (p: LatLon) => void;
  vector: (p: LatLon) => void;
  toa: (p: LatLon) => void;
  selectAlert: (id: string) => void;
}

export interface ProContext {
  sync: ProSync;
  /** Pane id → sampler. Mutated in place: panes register and leave without re-rendering anyone. */
  probes: Map<string, PaneProbe>;
  tools: ToolActions;
}

const Ctx = createContext<ProContext | null>(null);
export const ProProvider = Ctx.Provider;

export function usePro(): ProContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePro outside the Professional workspace");
  return v;
}
