"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { skyPhase, sunPosition } from "@/lib/astro/sun";
import { describeCode } from "@/lib/weather/wmo";
import { useNow } from "@/hooks/use-now";
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

const STARS = Array.from({ length: 90 }, (_, i) => {
  // Deterministic pseudo-random layout (stable across renders & SSR).
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1) * 100, y: r(2) * 55, s: 0.6 + r(3) * 1.6, d: 2 + r(4) * 5, o: 0.25 + r(5) * 0.6 };
});

/**
 * Real-time sky: gradient from the true solar altitude at the location
 * (golden hour, civil twilight, night), clouds scaled by cover and pushed by
 * the actual wind, precipitation particles sized by WMO intensity and
 * measured rate, lightning for convective codes.
 */
export function WeatherBackground({ lat, lon, code, cloudPct, windMs, windDirDeg, precipMm, hidden }: Props) {
  const now = useNow(5 * 60_000);
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
  const cloudDuration = Math.max(40, 160 - (windMs ?? 3) * 8);

  // Map solar azimuth (90°E → 270°W) across the viewport, altitude to height.
  const lumX = Math.max(-10, Math.min(110, ((sun.azimuth - 90) / 180) * 100));
  const lumY = Math.max(-5, 60 - sun.altitude * 1.6);
  const showLuminary = (scene === "clear" || scene === "partly") && sun.altitude > -8;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden transition-opacity duration-700"
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
          transition={{ duration: 1.8, ease: "easeInOut" }}
        />
      </AnimatePresence>

      {isNight && cover < 0.7 && (
        <div className="absolute inset-0" style={{ opacity: 1 - cover }}>
          {STARS.map((s, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.s,
                height: s.s,
                opacity: s.o,
                animation: `twinkle ${s.d}s ease-in-out ${i % 7}s infinite alternate`,
              }}
            />
          ))}
        </div>
      )}

      {showLuminary && (
        <div
          className="absolute size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl transition-all duration-[3000ms]"
          style={{ left: `${lumX}%`, top: `${lumY}%`, background: `radial-gradient(circle, ${luminaryGlow(phase)} 0%, transparent 62%)` }}
        />
      )}

      {/* Cloud deck: blurred blobs drifting with the real wind. */}
      {cover > 0.05 &&
        [0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full blur-3xl"
            style={{
              top: `${4 + i * 9}%`,
              width: `${55 + i * 12}vw`,
              height: `${18 + i * 4}vh`,
              background:
                scene === "storm" || scene === "hail"
                  ? "radial-gradient(ellipse, rgba(40,52,48,0.85), transparent 70%)"
                  : isNight
                    ? "radial-gradient(ellipse, rgba(70,80,100,0.35), transparent 70%)"
                    : "radial-gradient(ellipse, rgba(200,210,225,0.28), transparent 70%)",
              opacity: Math.min(1, cover * 1.15),
            }}
            initial={{ x: windPush < 0 ? "110vw" : "-80vw" }}
            animate={{ x: windPush < 0 ? "-80vw" : "110vw" }}
            transition={{ duration: cloudDuration * (1 + i * 0.35), repeat: Infinity, ease: "linear", delay: -i * cloudDuration * 0.4 }}
          />
        ))}

      {scene === "fog" &&
        [0, 1, 2].map((i) => (
          <motion.div
            key={`fog${i}`}
            className="absolute h-[30vh] w-[160vw] rounded-full bg-white/[0.07] blur-3xl"
            style={{ top: `${35 + i * 18}%`, left: "-30vw" }}
            animate={{ x: ["-10vw", "10vw", "-10vw"] }}
            transition={{ duration: 40 + i * 12, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}

      <PrecipCanvas kind={kind} intensity={intensity} wind={windPush} lightning={scene === "storm" || scene === "hail"} paused={!!hidden} />

      {/* Readability: content sits on a vignette that falls to black. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_30%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}
