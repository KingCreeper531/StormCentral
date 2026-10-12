import type { SkyPhase } from "@/lib/astro/sun";
import type { Scene } from "@/lib/weather/wmo";

/**
 * Sky palettes: muted, low-luminance tints that read as atmosphere rather
 * than colour. Each one carries its hue only in the top band (behind the
 * hero) and reaches true black by ~60% of the viewport, where solid panels
 * take over. Below the top bar, with the background scrim applied, every
 * text token (down to ink-3) keeps ≥ 4.5:1 on the bare sky.
 */
export function skyGradient(scene: Scene, phase: SkyPhase): string {
  const night = phase === "night" || phase === "astronomical";
  const twilight = phase === "nautical" || phase === "civil";
  const golden = phase === "golden";

  if (scene === "storm" || scene === "hail")
    return night
      ? "linear-gradient(180deg,#06080a 0%,#080d0c 34%,#000 56%)"
      : "linear-gradient(180deg,#121918 0%,#101614 22%,#090d0c 40%,#000 56%)";
  if (scene === "cloudy" || scene === "drizzle" || scene === "rain" || scene === "freezing")
    return night
      ? "linear-gradient(180deg,#08090c 0%,#0a0c10 32%,#000 58%)"
      : "linear-gradient(180deg,#171b22 0%,#13171d 22%,#0b0e12 40%,#000 58%)";
  if (scene === "snow")
    return night
      ? "linear-gradient(180deg,#090c12 0%,#0c111b 34%,#000 58%)"
      : "linear-gradient(180deg,#181d26 0%,#151921 24%,#0d1015 40%,#000 58%)";
  if (scene === "fog") return "linear-gradient(180deg,#181a1e 0%,#15171b 26%,#0c0d10 42%,#000 58%)";

  // clear / partly
  if (night) return "linear-gradient(180deg,#05070d 0%,#060a13 30%,#020306 48%,#000 60%)";
  if (twilight) return "linear-gradient(180deg,#0d1124 0%,#15162b 24%,#1a1420 40%,#000 60%)";
  if (golden) return "linear-gradient(180deg,#111a2e 0%,#1b1c2c 22%,#2d2124 38%,#0f0b0a 50%,#000 60%)";
  return "linear-gradient(180deg,#0f2040 0%,#0d1c35 20%,#091323 38%,#04070c 50%,#000 60%)";
}

/** Colour of the small, faint glow around the sun/moon disc. */
export function luminaryGlow(phase: SkyPhase): string {
  if (phase === "golden") return "rgba(255,186,120,0.11)";
  if (phase === "civil" || phase === "nautical") return "rgba(240,160,170,0.08)";
  if (phase === "day") return "rgba(255,246,228,0.06)";
  return "rgba(205,215,240,0.06)"; // moon
}

/**
 * Vivid, full-height skies for themes that ask for them ("sky": "vivid"),
 * in the clean style of Material weather apps: airy cyan-blue days, peach
 * sunrises and sunsets, deep indigo nights, soft greys for cloud, rain and
 * snow. Day skies are light (dark text, white cards); night skies are deep
 * (white text, dark cards), matching a theme that follows the sun.
 */
export function vividSkyGradient(scene: Scene, phase: SkyPhase): string {
  const night = phase === "night" || phase === "astronomical" || phase === "nautical";
  const twilight = phase === "civil";
  const golden = phase === "golden";
  if (scene === "storm" || scene === "hail")
    return night ? "linear-gradient(180deg,#1b1d3a 0%,#272a4d 55%,#33375e 100%)" : "linear-gradient(180deg,#7d8aa3 0%,#9aa6bb 55%,#b6c0d0 100%)";
  if (scene === "rain" || scene === "drizzle" || scene === "freezing")
    return night ? "linear-gradient(180deg,#1f2447 0%,#2c3360 55%,#3a4273 100%)" : "linear-gradient(180deg,#93a9bf 0%,#b1c2d2 55%,#cbd7e2 100%)";
  if (scene === "cloudy")
    return night ? "linear-gradient(180deg,#24285a 0%,#31367a 55%,#3f4591 100%)" : "linear-gradient(180deg,#a7c4d8 0%,#c3d6e3 55%,#dae6ee 100%)";
  if (scene === "snow")
    return night ? "linear-gradient(180deg,#2a3166 0%,#38408a 55%,#4851a3 100%)" : "linear-gradient(180deg,#bcd3e4 0%,#d4e3ee 55%,#e9f1f7 100%)";
  if (scene === "fog") return night ? "linear-gradient(180deg,#2a2e4f 0%,#3a3f66 100%)" : "linear-gradient(180deg,#b9c3cb 0%,#d4dadf 100%)";
  // clear / partly
  if (night) return "linear-gradient(180deg,#2a2c8c 0%,#3a3dab 50%,#5357cf 100%)";
  if (twilight) return "linear-gradient(180deg,#5d6fd0 0%,#b48fd6 55%,#f4b6b8 100%)";
  if (golden) return "linear-gradient(180deg,#8fcdf0 0%,#ffd2a6 60%,#ffc08a 100%)";
  return "linear-gradient(180deg,#7fd2f3 0%,#a9e1f6 50%,#cdeef9 100%)";
}
