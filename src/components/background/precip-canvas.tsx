"use client";

import { useEffect, useRef } from "react";

export type PrecipKind = "none" | "drizzle" | "rain" | "snow" | "hail" | "sleet";

interface Particle {
  x: number;
  y: number;
  z: number; // depth 0.3..1 → parallax, size, speed
  vx: number;
  vy: number;
  phase: number;
  len: number;
}

interface Props {
  kind: PrecipKind;
  /** 0..1 */
  intensity: number;
  /** Screen-space wind push, -1..1 (negative = blowing left). */
  wind: number;
  lightning: boolean;
  paused: boolean;
}

/**
 * Canvas2D precipitation engine. One draw call batch per frame (a single
 * path for rain streaks), DPR capped at 1.5, particle budget scaled to
 * screen area, and the loop parks itself when the tab is hidden.
 */
export function PrecipCanvas({ kind, intensity, wind, lightning, paused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const cfg = useRef({ kind, intensity, wind, lightning, paused });
  useEffect(() => {
    cfg.current = { kind, intensity, wind, lightning, paused };
  }, [kind, intensity, wind, lightning, paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let raf = 0;
    let last = performance.now();
    let nextFlash = last + 3000 + Math.random() * 6000;
    let bolt: { pts: [number, number][]; until: number } | null = null;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (p: Partial<Particle> = {}): Particle => {
      const z = 0.3 + Math.random() * 0.7;
      return { x: Math.random() * w, y: Math.random() * h, z, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2, len: 0, ...p };
    };

    const budget = () => {
      const { kind: k, intensity: i } = cfg.current;
      if (k === "none" || i <= 0) return 0;
      const area = (w * h) / 10_000;
      const per = k === "snow" ? 1.6 : k === "drizzle" ? 2.2 : k === "hail" ? 0.9 : 3.2;
      return Math.min(k === "snow" ? 420 : 900, Math.round(area * per * (0.25 + i)));
    };

    const makeBolt = (): [number, number][] => {
      const pts: [number, number][] = [];
      let x = w * (0.15 + Math.random() * 0.7);
      let y = 0;
      while (y < h * (0.45 + Math.random() * 0.3)) {
        pts.push([x, y]);
        x += (Math.random() - 0.5) * 60;
        y += 18 + Math.random() * 30;
      }
      return pts;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = cfg.current;
      if (c.paused) return;

      const target = budget();
      // First fill covers the whole screen; later growth enters from above.
      const initial = particles.length === 0;
      if (particles.length < target)
        for (let i = particles.length; i < target; i++) particles.push(spawn(initial ? {} : { y: Math.random() * -h }));
      else if (particles.length > target) particles.length = target;

      ctx.clearRect(0, 0, w, h);
      const k = c.kind;
      const windPx = c.wind * (k === "snow" ? 60 : 260);

      if (k === "rain" || k === "drizzle" || k === "sleet") {
        ctx.strokeStyle = k === "drizzle" ? "rgba(190,210,235,0.28)" : "rgba(175,200,235,0.42)";
        ctx.lineWidth = k === "drizzle" ? 0.8 : 1.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        const speed = k === "drizzle" ? 520 : 1100;
        for (const p of particles) {
          const vy = speed * p.z;
          const vx = windPx * p.z;
          p.x += vx * dt;
          p.y += vy * dt;
          const len = (k === "drizzle" ? 7 : 16) * p.z * (0.6 + c.intensity);
          const nx = (vx / vy) * len;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - nx, p.y - len);
          if (p.y > h + 20 || p.x < -40 || p.x > w + 40) Object.assign(p, spawn({ y: -20, x: Math.random() * (w + 200) - 100 }));
        }
        ctx.stroke();
      } else if (k === "snow" || k === "hail") {
        ctx.fillStyle = k === "hail" ? "rgba(235,245,255,0.85)" : "rgba(255,255,255,0.78)";
        for (const p of particles) {
          p.phase += dt * (0.8 + p.z);
          const sway = k === "snow" ? Math.sin(p.phase) * 22 * p.z : 0;
          p.y += (k === "hail" ? 820 : 55 + 70 * p.z) * p.z * dt;
          p.x += (windPx * p.z + sway) * dt;
          const r = k === "hail" ? 1.4 + p.z * 1.6 : 0.8 + p.z * 2.2;
          ctx.globalAlpha = 0.35 + p.z * 0.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          if (p.y > h + 10 || p.x < -30 || p.x > w + 30) Object.assign(p, spawn({ y: -10, x: Math.random() * (w + 100) - 50 }));
        }
        ctx.globalAlpha = 1;
      }

      // Lightning: a jagged bolt + a sky flash on the overlay div.
      if (c.lightning && !reduced && now > nextFlash) {
        nextFlash = now + 4000 + Math.random() * 9000;
        bolt = Math.random() < 0.55 ? { pts: makeBolt(), until: now + 160 } : null;
        const el = flashRef.current;
        if (el) {
          el.animate(
            [{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0.1 }, { opacity: 0.4 }, { opacity: 0 }],
            { duration: 650, easing: "ease-out" },
          );
        }
      }
      if (bolt && now < bolt.until) {
        ctx.save();
        ctx.strokeStyle = "rgba(225,235,255,0.95)";
        ctx.shadowColor = "rgba(170,190,255,0.9)";
        ctx.shadowBlur = 18;
        ctx.lineWidth = 2;
        ctx.beginPath();
        bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.restore();
      }
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduced) {
      // Static frame only: a light sprinkle that conveys the condition.
      cfg.current = { ...cfg.current, intensity: Math.min(cfg.current.intensity, 0.4) };
      frame(performance.now());
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(frame);
    }
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduced) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
      particles = [];
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0" aria-hidden />
      <div ref={flashRef} className="pointer-events-none fixed inset-0 bg-[#dfe7ff] opacity-0 mix-blend-screen" aria-hidden />
    </>
  );
}
