"use client";

import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  nearestSlot,
  pickSatellite,
  SATELLITE_ATTRIBUTION,
  satelliteMaxzoom,
  satelliteSlot,
  satelliteTileUrl,
  slotsFor,
  type GoesSat,
  type SatBand,
} from "@/lib/radar/satellite";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

/** The satellite image currently on screen. */
export interface SatelliteImage {
  sat: GoesSat;
  band: SatBand;
  /** Epoch ms of the image (feed to `satelliteLabel`). */
  slotMs: number;
}

interface Props {
  band: SatBand;
  /** Radar loop frame times (epoch ms); their satellite images are prefetched. */
  times: readonly number[];
  /** Time to show: the current radar frame's, or `Date.now()` without a loop. */
  current: number;
  opacity?: number;
  /** Called when the image on screen changes (null when none). */
  onImage?: (image: SatelliteImage | null) => void;
}

/**
 * The same pre-buffered stack as the radar (lib/radar/layer-manager.ts), cut
 * down: one raster source + layer per 10-minute satellite slot, all at zero
 * opacity so their tiles load ahead of time, and the current one flipped on.
 * A flip waits until the new slot's tiles are in, so the loop never shows
 * half-drawn imagery; until then the previous image stays up.
 */
class SatellitePool {
  private slots: number[] = [];
  private visible: number | null = null;
  private current = NaN;
  private opacity = 0.75;
  private holding = false;
  private destroyed = false;

  constructor(
    private readonly map: MlMap,
    private readonly band: SatBand,
    private readonly sat: GoesSat,
    private readonly onImage: (image: SatelliteImage | null) => void,
  ) {
    map.on("sourcedata", this.onData);
    map.on("idle", this.onData);
  }

  /**
   * Reconcile the stack with `slots` (oldest → newest) and show the slot for
   * `current`. Existing slots are never re-created.
   */
  update(slots: readonly number[], current: number, opacity: number) {
    if (this.destroyed) return;
    const keep = new Set(slots);
    for (const s of this.slots) if (!keep.has(s)) this.remove(s);
    // Newest first, so the latest image's tiles are requested first. Checking the
    // map (not our list) also restores slots a style reload wiped out.
    for (let i = slots.length - 1; i >= 0; i--) if (!this.map.getSource(this.src(slots[i]!))) this.add(slots[i]!);
    this.slots = [...slots];
    if (this.visible !== null && !keep.has(this.visible)) {
      this.visible = null;
      this.onImage(null);
    }
    this.current = current;
    this.opacity = opacity;
    this.apply();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.map.off("sourcedata", this.onData);
    this.map.off("idle", this.onData);
    if (mapAlive(this.map)) for (const s of this.slots) this.remove(s);
    this.slots = [];
    if (this.visible !== null) this.onImage(null);
    this.visible = null;
  }

  private apply() {
    if (this.destroyed || !Number.isFinite(this.current)) return;
    const want = nearestSlot(this.slots, satelliteSlot(this.current));
    const prev = this.visible;
    let next = prev;
    if (want !== prev && (prev === null || want === null || this.loaded(want))) next = want;
    this.holding = next !== want;
    if (next !== null) this.paint(next, this.opacity);
    if (prev !== null && prev !== next) this.paint(prev, 0);
    if (next !== prev) {
      this.visible = next;
      this.onImage(next === null ? null : { sat: this.sat, band: this.band, slotMs: next });
    }
  }

  private add(slot: number) {
    const source = this.src(slot);
    this.map.addSource(source, {
      type: "raster",
      tiles: [satelliteTileUrl(this.band, this.sat, slot)],
      tileSize: 256,
      maxzoom: satelliteMaxzoom(this.band),
      attribution: SATELLITE_ATTRIBUTION,
    });
    this.map.addLayer(
      {
        id: this.lyr(slot),
        type: "raster",
        source,
        paint: {
          "raster-opacity": 0,
          "raster-opacity-transition": { duration: 0, delay: 0 },
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
          // Band 13 is grey everywhere: stretch it so warm ground sinks toward
          // the near-black basemap and cold cloud tops stand out.
          ...(this.band === "infrared" && { "raster-contrast": 0.25 }),
        },
      },
      this.map.getLayer(SLOTS.satellite) ? SLOTS.satellite : undefined,
    );
  }

  private remove(slot: number) {
    if (this.map.getLayer(this.lyr(slot))) this.map.removeLayer(this.lyr(slot));
    if (this.map.getSource(this.src(slot))) this.map.removeSource(this.src(slot));
  }

  private paint(slot: number, opacity: number) {
    if (this.map.getLayer(this.lyr(slot))) this.map.setPaintProperty(this.lyr(slot), "raster-opacity", opacity);
  }

  private loaded(slot: number) {
    if (!this.map.getSource(this.src(slot))) return false;
    try {
      return this.map.isSourceLoaded(this.src(slot));
    } catch {
      return false;
    }
  }

  private src(slot: number) {
    return `goes-src-${this.band}-${this.sat}-${slot}`;
  }

  private lyr(slot: number) {
    return `goes-lyr-${this.band}-${this.sat}-${slot}`;
  }

  /** Re-check a held flip as tiles arrive. */
  private readonly onData = () => {
    if (this.holding) this.apply();
  };
}

/**
 * GOES satellite imagery beneath everything else on the map, looping in step
 * with the radar. Picks GOES-East or GOES-West from the view centre.
 */
export function SatelliteLayer({ band, times, current, opacity = 0.75, onImage }: Props) {
  const { map } = useMapContext();
  const [sat, setSat] = useState<GoesSat>(() => (map ? pickSatellite(map.getCenter().lng) : "east"));
  const pool = useRef<SatellitePool | null>(null);
  const imageCb = useRef(onImage);
  useEffect(() => {
    imageCb.current = onImage;
  });

  // East/West follows the view (with a little hysteresis at the line).
  useEffect(() => {
    if (!map) return;
    const onMove = () => setSat((prev) => pickSatellite(map.getCenter().lng, prev));
    map.on("moveend", onMove);
    return () => {
      map.off("moveend", onMove);
    };
  }, [map]);

  // Frame times arrive as a fresh array each render; key on the slots they map to.
  const slotKey = slotsFor([...times, current]).join(",");
  const slots = useMemo(() => (slotKey ? slotKey.split(",").map(Number) : []), [slotKey]);

  useEffect(() => {
    if (!map) return;
    const p = new SatellitePool(map, band, sat, (img) => imageCb.current?.(img));
    pool.current = p;
    return () => {
      p.destroy();
      pool.current = null;
    };
  }, [map, band, sat]);

  // Runs on every frame flip: the diff is a few lookups, and it brings back
  // anything a style reload removed.
  useEffect(() => {
    pool.current?.update(slots, current, opacity);
  }, [map, band, sat, slots, current, opacity]);

  return null;
}
