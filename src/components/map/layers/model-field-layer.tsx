"use client";

import type { CanvasSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { latFromMercatorY, mercatorY } from "@/lib/geo";
import { bilinear, WindSampler, type ModelGrid } from "@/lib/model-fields/grid";
import { particleBudget, Particles, TRAIL, type ParticleView } from "@/lib/model-fields/particles";
import { FIELDS, writeColor, type ModelFieldId } from "@/lib/model-fields/scales";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

const SRC = "model-field";
const LYR = "model-field-layer";
/** Long side of the colour image; the grid is upsampled to it so colour bands follow the values, not blended colours. */
const IMAGE_PX = 256;
/** Particle caps: phones and tablets get fewer (their GPUs and batteries are smaller). */
const CAP_FINE = 3000;
const CAP_COARSE = 900;
/** Trails fade by this much per 60 Hz frame. */
const FADE = 0.88;
const ALPHA = 0.85;
/** How often the particle canvas is redrawn clean (ms). */
const CLEAN_MS = 4000;

interface Props {
  field: ModelFieldId;
  grid: ModelGrid;
  /** Index into `grid.times`. */
  hour: number;
  /** Wind particles on top of the colour map. */
  particles: boolean;
  opacity?: number;
}

/**
 * The model map: a colour field under the radar (a canvas image source in
 * the heat slot, redrawn only when the field or hour changes) and wind
 * particles on a single 2D canvas over the map.
 */
export function ModelFieldLayer({ field, grid, hour, particles, opacity = 0.65 }: Props) {
  const { map, dark } = useMapContext();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The image source, re-made when the grid (and so its corners) changes.
  useEffect(() => {
    if (!map) return;
    const scale = Math.max(1, Math.min(32, Math.ceil(IMAGE_PX / Math.max(grid.cols, grid.rows))));
    const canvas = document.createElement("canvas");
    canvas.width = grid.cols * scale;
    canvas.height = grid.rows * scale;
    canvasRef.current = canvas;
    const { west, east, north, south } = grid.bbox;
    map.addSource(SRC, {
      type: "canvas",
      canvas,
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
      animate: false,
    });
    map.addLayer({ id: LYR, type: "raster", source: SRC, paint: { "raster-opacity": opacity, "raster-resampling": "linear", "raster-fade-duration": 0 } }, SLOTS.heat);
    return () => {
      canvasRef.current = null;
      if (!mapAlive(map)) return;
      if (map.getLayer(LYR)) map.removeLayer(LYR);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map, grid, opacity]);

  // Paint the chosen field and hour into it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!map || !canvas || !ctx) return;
    const def = FIELDS[field];
    const values = grid.values[def.variable][hour];
    const img = ctx.createImageData(canvas.width, canvas.height);
    if (values) {
      const sx = grid.cols / canvas.width;
      const sy = grid.rows / canvas.height;
      for (let py = 0; py < canvas.height; py++) {
        const fy = (py + 0.5) * sy - 0.5;
        for (let px = 0; px < canvas.width; px++) {
          writeColor(def.stops, bilinear(values, grid.cols, grid.rows, (px + 0.5) * sx - 0.5, fy), img.data, (py * canvas.width + px) * 4);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // A static canvas source uploads only when told: play() then pause() re-reads it once.
    const src = map.getSource(SRC) as CanvasSource | undefined;
    if (src) {
      src.play();
      src.pause();
    }
    map.triggerRepaint();
  }, [map, grid, field, hour]);

  return particles && map ? <WindParticles map={map} grid={grid} hour={hour} color={FIELDS[field].opaque || dark ? "255, 255, 255" : "28, 30, 38"} /> : null;
}

/**
 * Wind particles drawn on one 2D canvas just above the map's own canvas
 * (below markers and controls). One stroke a frame (the trails fade on the
 * canvas), a hard particle cap, about 30 frames a second on touch devices,
 * stopped while the tab is hidden and cleared while the map moves (screen
 * trails would smear).
 */
function WindParticles({ map, grid, hour, color }: { map: MlMap; grid: ModelGrid; hour: number; color: string }) {
  const cfg = useRef({ wind: new WindSampler(grid, hour), color });
  /** Set while reduced motion is on: redraws the still streamlines. */
  const redraw = useRef<(() => void) | null>(null);
  useEffect(() => {
    cfg.current = { wind: new WindSampler(grid, hour), color };
  }, [grid, hour, color]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none" });
    map.getCanvas().insertAdjacentElement("afterend", canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      return;
    }
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const container = map.getContainer();
    let w = 0;
    let h = 0;
    let system = new Particles(0);
    let raf = 0;
    let last = 0;
    let cleaned = 0;
    let moving = false;
    const lngLat: [number, number] = [0, 0];

    const view: ParticleView = {
      width: 0,
      height: 0,
      pxPerDeg: 1,
      project: (lon, y, out) => {
        lngLat[0] = lon;
        lngLat[1] = latFromMercatorY(y);
        const p = map.project(lngLat);
        out[0] = p.x;
        out[1] = p.y;
      },
      spawn: (out) => {
        const ll = map.unproject([Math.random() * w, Math.random() * h]);
        out[0] = ((((ll.lng + 180) % 360) + 360) % 360) - 180;
        out[1] = mercatorY(Math.max(-85, Math.min(85, ll.lat)));
      },
    };
    const syncView = () => {
      view.width = w;
      view.height = h;
      // MapLibre's world is 512 px wide at zoom 0.
      view.pxPerDeg = (512 * 2 ** map.getZoom()) / 360;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = container.clientWidth;
      h = container.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      system = new Particles(particleBudget(w, h, coarse ? CAP_COARSE : CAP_FINE));
      syncView();
      system.reset(view);
    };

    const style = () => {
      ctx.lineWidth = coarse ? 1.4 : 1.2;
      ctx.lineCap = "butt";
    };
    /** Each frame: fade what's there and add the newest step of every trail (one stroke). */
    const drawStep = (frames: number) => {
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = `rgba(0, 0, 0, ${(FADE ** frames).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      style();
      ctx.strokeStyle = `rgba(${cfg.current.color}, ${ALPHA})`;
      ctx.beginPath();
      const { trail, len } = system;
      for (let i = 0; i < system.count; i++) {
        if (len[i]! < 2) continue;
        const a = system.point(i, 1);
        const b = system.point(i, 0);
        ctx.moveTo(trail[a]!, trail[a + 1]!);
        ctx.lineTo(trail[b]!, trail[b + 1]!);
      }
      ctx.stroke();
    };
    /**
     * Now and then: clear and redraw every trail from its history. Fading in
     * 8-bit steps never quite reaches zero, so faint leftovers would otherwise
     * build up into a haze. One stroke per trail age.
     */
    const drawAll = () => {
      ctx.clearRect(0, 0, w, h);
      style();
      const { trail, len } = system;
      for (let k = 0; k < TRAIL - 1; k++) {
        ctx.strokeStyle = `rgba(${cfg.current.color}, ${(ALPHA * FADE ** k).toFixed(3)})`;
        ctx.beginPath();
        for (let i = 0; i < system.count; i++) {
          if (len[i]! <= k + 1) continue;
          const a = system.point(i, k + 1);
          const b = system.point(i, k);
          ctx.moveTo(trail[a]!, trail[a + 1]!);
          ctx.lineTo(trail[b]!, trail[b + 1]!);
        }
        ctx.stroke();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (moving) return;
      // Touch devices draw about 30 times a second; particles keep the same speed either way.
      if (coarse && now - last < 30) return;
      const frames = last ? Math.min(4, (now - last) / (1000 / 60)) : 1;
      last = now;
      syncView();
      system.step(cfg.current.wind, view, frames);
      if (now - cleaned > CLEAN_MS) {
        cleaned = now;
        drawAll();
      } else drawStep(frames);
    };

    /** Reduced motion: the streamlines drawn once, still. */
    const still = () => {
      syncView();
      system.reset(view);
      for (let i = 0; i < TRAIL; i++) system.step(cfg.current.wind, view);
      drawAll();
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (reduced) still();
      else if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    const onMoveStart = () => {
      moving = true;
      ctx.clearRect(0, 0, w, h);
    };
    const onMoveEnd = () => {
      moving = false;
      syncView();
      system.reset(view);
      if (reduced) still();
    };
    const onResize = () => {
      resize();
      if (reduced) still();
    };
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());

    if (reduced) redraw.current = still;
    resize();
    start();
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);
    map.on("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      redraw.current = null;
      canvas.remove();
    };
  }, [map]);

  // Reduced motion draws once, so a new hour or grid redraws it (the loop picks changes up by itself).
  useEffect(() => redraw.current?.(), [grid, hour, color]);

  return null;
}
