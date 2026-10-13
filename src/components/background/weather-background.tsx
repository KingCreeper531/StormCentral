"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { skyPhase, sunPosition } from "@/lib/astro/sun";
import { describeCode } from "@/lib/weather/wmo";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { selectActiveTheme, useAddonsStore } from "@/store/addons-store";
import { luminaryGlow, skyGradient, vividSkyGradient } from "./sky";
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
/** Vivid skies stay bright: just a hint of depth at the very bottom. */
const SCRIM_VIVID = "linear-gradient(180deg, transparent 70%, rgba(0,0,0,0.06) 100%)";

/** Soft light discs drifting near the top of vivid day skies (the "bubbles" of Material weather apps). */
const BUBBLES = [
  { x: 78, y: 4, s: 46, d: 26 },
  { x: 58, y: -8, s: 34, d: 34 },
  { x: 96, y: 18, s: 30, d: 30 },
] as const;

/**
 * Real-time sky: gradient from the true solar altitude at the location
 * (golden hour, civil twilight, night), clouds scaled by cover and pushed by
 * the actual wind, precipitation particles sized by WMO intensity and
 * measured rate, lightning for convective codes. Kept deliberately dim so it
 * reads as atmosphere behind the hero, never as decoration competing with data.
 */
/**
 * Whether a vivid-sky theme is on, read from <html data-sky> rather than the
 * add-ons store: the boot script sets it before the page paints, so the very
 * first client render already shows the theme's sky (no dark sky behind a
 * light page while the store loads).
 */
function subscribeSky(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sky"] });
  return () => mo.disconnect();
}
const skySnapshot = () => document.documentElement.dataset.sky === "vivid";

/** Gradient layers fade over each other when the sky itself changes; a theme switch swaps instantly. */
const GRADIENT_VARIANTS = {
  hidden: { opacity: 0 },
  shown: (instant: boolean) => ({ opacity: 1, transition: { duration: instant ? 0 : 1.5, ease: "easeInOut" as const } }),
  gone: (instant: boolean) => ({ opacity: 0, transition: { duration: instant ? 0 : 1.5, ease: "easeInOut" as const } }),
};

export function WeatherBackground({ lat, lon, code, cloudPct, windMs, windDirDeg, precipMm, hidden }: Props) {
  const now = useNow(5 * 60_000);
  // Hydration-safe (false on the server); animated nodes are keyed on it so they remount cleanly.
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const light = useResolvedTheme() === "light";
  // Themes can ask for full, saturated skies (e.g. the "Sky" theme): see vividSkyGradient.
  const vividTheme = useAddonsStore((s) => selectActiveTheme(s)?.sky === "vivid");
  const vividDoc = useSyncExternalStore(subscribeSky, skySnapshot, () => false);
  const vivid = vividDoc || vividTheme;
  const sun = useMemo(() => sunPosition(new Date(now), lat, lon), [now, lat, lon]);
  const phase = skyPhase(sun.altitude);
  const info = describeCode(code);
  const scene = info.scene;
  const gradient = vivid ? vividSkyGradient(scene, phase) : skyGradient(scene, phase);
  // Fade only when the weather or time of day changes the sky; a theme change (or the
  // first render after loading) swaps at once. Remembered per gradient change, so the
  // fade's speed doesn't change mid-way.
  const skyKey = `${scene}|${phase}`;
  const [shown, setShown] = useState({ gradient, skyKey, instant: true });
  if (shown.gradient !== gradient) setShown({ gradient, skyKey, instant: reduced || shown.skyKey === skyKey });
  const instant = shown.gradient === gradient ? shown.instant : true;
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

  const cloudFill = vivid
    ? scene === "storm" || scene === "hail"
      ? "radial-gradient(ellipse closest-side, rgba(40,46,58,0.8), transparent)"
      : isNight
        ? "radial-gradient(ellipse closest-side, rgba(170,182,210,0.2), transparent)"
        : "radial-gradient(ellipse closest-side, rgba(255,255,255,0.6), transparent)"
    : scene === "storm" || scene === "hail"
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
      <AnimatePresence initial={false} custom={instant}>
        <motion.div
          key={gradient}
          className="absolute inset-0"
          style={{ background: gradient }}
          custom={instant}
          variants={GRADIENT_VARIANTS}
          initial="hidden"
          animate="shown"
          exit="gone"
        />
      </AnimatePresence>

      {/* Vivid days: big translucent discs that drift slowly. */}
      {vivid &&
        !isNight &&
        BUBBLES.map((b, i) => (
          <motion.div
            key={`bubble${i}${reduced ? "s" : "a"}`}
            className="absolute rounded-full"
            style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.s}vmax`, height: `${b.s}vmax`, x: "-50%", background: "rgba(255,255,255,0.16)" }}
            animate={reduced ? undefined : { y: ["0vmax", "2.5vmax", "0vmax"], scale: [1, 1.04, 1] }}
            transition={{ duration: b.d, repeat: Infinity, ease: "easeInOut", delay: -i * 5 }}
          />
        ))}

      {isNight && cover < 0.7 && (
        <div className="absolute inset-0" style={{ opacity: Math.min(1, (1 - cover) * (vivid ? 1.6 : 1)) }}>
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

      {showLuminary && !vivid && (
        <div
          className="absolute size-40 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-[3000ms]"
          style={{ left: `${lumX}%`, top: `${lumY}%`, background: `radial-gradient(circle closest-side, ${luminaryGlow(phase)}, transparent)` }}
        />
      )}
      {/* Vivid: a real sun or moon disc with a slowly breathing glow. */}
      {showLuminary && vivid && (
        <div className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-[3000ms]" style={{ left: `${lumX}%`, top: `${lumY}%` }}>
          <div
            className="absolute top-1/2 left-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: isNight ? "radial-gradient(circle closest-side, rgba(200,215,255,0.22), transparent)" : "radial-gradient(circle closest-side, rgba(255,236,170,0.45), rgba(255,210,120,0.12) 55%, transparent)",
              animation: reduced ? undefined : "sky-breathe 9s ease-in-out infinite",
            }}
          />
          <div
            className="relative size-14 rounded-full"
            style={{ background: isNight ? "radial-gradient(circle at 35% 35%, #f4f6ff, #c9d2ec)" : "radial-gradient(circle at 40% 40%, #fffbe8, #ffd76a)", boxShadow: isNight ? "0 0 30px rgba(210,220,255,0.5)" : "0 0 60px rgba(255,214,110,0.8)" }}
          />
        </div>
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
              opacity: Math.min(0.9, cover * (vivid ? 1 : 0.85)),
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

      <div className="absolute inset-0" style={{ background: vivid ? SCRIM_VIVID : light ? SCRIM_LIGHT : SCRIM }} />
    </div>
  );
}
