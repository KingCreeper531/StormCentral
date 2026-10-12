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
 * in the style of phone weather apps: saturated blues by day, warm golden
 * hours, deep navy nights, slate rain and storm. Mid-tone throughout so
 * white text with a soft shadow stays readable at the top of the screen.
 */
export function vividSkyGradient(scene: Scene, phase: SkyPhase): string {
  const night = phase === "night" || phase === "astronomical";
  const twilight = phase === "nautical" || phase === "civil";
  const golden = phase === "golden";
  if (scene === "storm" || scene === "hail")
    return night ? "linear-gradient(180deg,#0d1018 0%,#1a1f2b 50%,#262c3a 100%)" : "linear-gradient(180deg,#232a37 0%,#363e4e 45%,#4b5466 100%)";
  if (scene === "rain" || scene === "drizzle" || scene === "freezing")
    return night ? "linear-gradient(180deg,#0f1622 0%,#1b2534 50%,#283447 100%)" : "linear-gradient(180deg,#3a4b61 0%,#4f6279 45%,#677b93 100%)";
  if (scene === "cloudy")
    return night ? "linear-gradient(180deg,#141b27 0%,#222c3b 50%,#313c4d 100%)" : "linear-gradient(180deg,#4f6582 0%,#667d99 45%,#8195b0 100%)";
  if (scene === "snow")
    return night ? "linear-gradient(180deg,#18223a 0%,#26324d 50%,#36435f 100%)" : "linear-gradient(180deg,#5b7596 0%,#7590b0 45%,#8fa7c3 100%)";
  if (scene === "fog") return night ? "linear-gradient(180deg,#1c222c 0%,#2a313c 100%)" : "linear-gradient(180deg,#68737f 0%,#87919c 100%)";
  // clear / partly
  if (night) return "linear-gradient(180deg,#070d24 0%,#101c45 45%,#1d2d62 100%)";
  if (twilight) return "linear-gradient(180deg,#1b2452 0%,#56407a 45%,#c2687a 100%)";
  if (golden) return "linear-gradient(180deg,#24427f 0%,#b0607a 50%,#ee9a5a 100%)";
  return "linear-gradient(180deg,#145fc4 0%,#2f7fe0 45%,#5aa2ea 100%)";
}
