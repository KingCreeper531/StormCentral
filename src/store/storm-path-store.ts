"use client";

import { create } from "zustand";
import type { PathTown } from "@/lib/storm-path";

/**
 * The towns in each warned storm's path, by warning id, as the map's storm
 * path layer finds them (from the basemap's town labels) for the warning's
 * details to list. Only on this screen, never saved.
 */
interface StormPathState {
  towns: Record<string, PathTown[]>;
  setTowns: (towns: Record<string, PathTown[]>) => void;
}

export const useStormPathStore = create<StormPathState>()((set) => ({
  towns: {},
  setTowns: (towns) => set({ towns }),
}));
