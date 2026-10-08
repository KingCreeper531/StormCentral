"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { skyPhase, sunPosition } from "@/lib/astro/sun";
import { describeCode } from "@/lib/weather/wmo";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { luminaryGlow, skyGradient } from "./sky";
import { PrecipCanvas, type PrecipKind } from "./precip-canvas";

interface Props {
  lat: number;
  lon: number;
  code: number | null;
  cloudPct: number | null;
  windMs: number | null;
  windDirDeg: number | null;
  precipMm: number | null;
  /** Hide (but keep mounted) when an immersive map covers the screen. */
  hidden?: boolean;
}

const STARS = Array.from({ length: 60 }, (_, i) => {
  // Deterministic pseudo-random layout (stable across renders & SSR).
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1) * 100, y: r(2) * 42, s: 0.5 + r(3) * 0.9, d: 5 + r(4) * 6, o: 0.15 + r(5) * 0.4 };
});

/** Cloud bands: few, wide and faint. Static left offsets are used when motion is reduced. */
const CLOUDS = [
  { top: 0, w: 62, h: 16, left: -12 },
  { top: 9, w: 74, h: 19, left: 34 },
  { top: 18, w: 86, h: 22, left: 4 },
] as const;

/**
 * Scrim over the whole scene, in two layers. A side vignette keeps the edges
 * dark. A vertical fade lets the sky show behind the hero and leaves the
 * canvas black below ~55vh, where solid panels sit.
 */
const SCRIM = [
  "radial-gradient(130% 75% at 50% 0%, transparent 55%, rgba(0,0,0,0.5) 100%)",
  "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.12) 12%, rgba(0,0,0,0.45) 30%, rgba(0,0,0,0.82) 42%, #000 55%)",
].join(",");
/**
 * Light theme: a pale wash keeps the real sky colour as a tint behind the hero
 * (dark text stays ≥ 4.5:1 even over the night sky) and reaches the solid
 * canvas sooner.
 */
const SCRIM_LIGHT = "linear-gradient(180deg, rgb(243 244 246 / 0.62) 0%, rgb(243 244 246 / 0.7) 18%, rgb(243 244 246 / 0.9) 32%, #f3f4f6 44%)";

/**
 * Real-time sky: gradient from the true solar altitude at the location
 * (golden hour, civil twilight, night), clouds scaled by cover and pushed by
 * the actual wind, precipitation particles sized by WMO intensity and
 * measured rate, lightning for convective codes. Kept deliberately dim so it
 * reads as atmosphere behind the hero, never as decoration competing with data.
 */
export function WeatherBackground({ lat, lon, code, cloudPct, windMs, windDirDeg, precipMm, hidden }: Props) {
  const now = useNow(5 * 60_000);
  // Hydration-safe (false on the server); animated nodes are keyed on it so they remount cleanly.
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const light = useResolvedTheme() === "light";
  const sun = useMemo(() => sunPosition(new Date(now), lat, lon), [now, lat, lon]);
  const phase = skyPhase(sun.altitude);
  const info = describeCode(code);
  const scene = info.scene;
  const gradient = skyGradient(scene, phase);
  const isNight = phase === "night" || phase === "astronomical" || phase === "nautical";

  const kind: PrecipKind =
    scene === "rain" ? "rain" : scene === "drizzle" ? "drizzle" : scene === "snow" ? "snow" : scene === "hail" ? "hail" : scene === "freezing" ? "sleet" : scene === "storm" ? "rain" : "none";
  // Blend the code's nominal intensity with the measured rate (mm/h).
  const intensity = Math.min(1, Math.max(info.intensity, precipMm ? Math.min(1, precipMm / 8) : 0));
  // Screen x-push from the east-west wind component (blowing toward +x = east).
  const u = windMs != null && windDirDeg != null ? -windMs * Math.sin((windDirDeg * Math.PI) / 180) : 0;
  const windPush = Math.max(-1, Math.min(1, u / 15));
  const cover = (cloudPct ?? 0) / 100;
  const cloudDuration = Math.max(60, 200 - (windMs ?? 3) * 8);

  // Map solar azimuth (90°E → 270°W) across the viewport; altitude to height
  // within the visible sky band (a low sun sinks into the fade).
  const lumX = Math.max(-10, Math.min(110, ((sun.azimuth - 90) / 180) * 100));
  const lumY = Math.max(4, Math.min(46, 40 - sun.altitude * 0.9));
  const showLuminary = (scene === "clear" || scene === "partly") && sun.altitude > -8;

  const cloudFill =
    scene === "storm" || scene === "hail"
      ? "radial-gradient(ellipse closest-side, rgba(28,34,36,0.75), transparent)"
      : isNight
        ? "radial-gradient(ellipse closest-side, rgba(60,68,84,0.22), transparent)"
        : "radial-gradient(ellipse closest-side, rgba(190,200,215,0.09), transparent)";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas transition-opacity duration-700"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={gradient}
          className="absolute inset-0"
          style={{ background: gradient }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 1.5, ease: "easeInOut" }}
        />
      </AnimatePresence>

      {isNight && cover < 0.7 && (
        <div className="absolute inset-0" style={{ opacity: 1 - cover }}>
          {STARS.map((s, i) => (
            // Outer span sets the star's brightness; the inner one twinkles within it.
            <span key={i} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%`, opacity: s.o }}>
              <span
                className="block rounded-full bg-white"
                style={{
                  width: s.s,
                  height: s.s,
                  animation: reduced ? undefined : `twinkle ${s.d}s ease-in-out ${i % 9}s infinite alternate`,
                }}
              />
            </span>
          ))}
        </div>
      )}

      {showLuminary && (
        <div
          className="absolute size-40 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-[3000ms]"
          style={{ left: `${lumX}%`, top: `${lumY}%`, background: `radial-gradient(circle closest-side, ${luminaryGlow(phase)}, transparent)` }}
        />
      )}

      {/* Cloud deck: soft bands drifting with the real wind. */}
      {cover > 0.05 &&
        CLOUDS.map((c, i) => (
          <motion.div
            key={`${i}${reduced ? "s" : "a"}`}
            className="absolute"
            style={{
              top: `${c.top}%`,
              left: reduced ? `${c.left}vw` : 0,
              width: `${c.w}vw`,
              height: `${c.h}vh`,
              background: cloudFill,
              opacity: Math.min(0.9, cover * 0.85),
            }}
            initial={reduced ? false : { x: windPush < 0 ? "110vw" : "-90vw" }}
            animate={reduced ? undefined : { x: windPush < 0 ? "-90vw" : "110vw" }}
            transition={{ duration: cloudDuration * (1 + i * 0.35), repeat: Infinity, ease: "linear", delay: -i * cloudDuration * 0.4 }}
          />
        ))}

      {scene === "fog" &&
        [0, 1, 2].map((i) => (
          <motion.div
            key={`fog${i}${reduced ? "s" : "a"}`}
            className="absolute h-[26vh] w-[160vw]"
            style={{ top: `${6 + i * 14}%`, left: "-30vw", background: "radial-gradient(ellipse closest-side, rgba(200,205,212,0.06), transparent)" }}
            animate={reduced ? undefined : { x: ["-10vw", "10vw", "-10vw"] }}
            transition={{ duration: 48 + i * 14, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}

      <PrecipCanvas kind={kind} intensity={intensity} wind={windPush} lightning={scene === "storm" || scene === "hail"} paused={!!hidden} />

      <div className="absolute inset-0" style={{ background: light ? SCRIM_LIGHT : SCRIM }} />
    </div>
  );
}
