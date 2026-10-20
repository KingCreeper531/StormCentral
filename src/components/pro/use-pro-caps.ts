"use client";

import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * What this device can comfortably run in Professional mode. Phones and
 * touch tablets get the lighter version: at most two panels, short loops,
 * and no Level II volumes (multi-megabyte files per frame).
 */
export function useProCaps() {
  const wide = useMediaQuery("(min-width: 768px)");
  const fine = useMediaQuery("(pointer: fine)");
  const full = wide && fine;
  return {
    /** Phone-sized screen. */
    narrow: !wide,
    /** Level II volume products. */
    volume: full,
    maxFrames: full ? 20 : 6,
  };
}

export type ProCaps = ReturnType<typeof useProCaps>;
