import type { SkyPhase } from "@/lib/astro/sun";
import type { Scene } from "@/lib/weather/wmo";

/**
 * Sky palettes: deep and low-luminance so the canvas stays OLED-friendly and
 * text contrast holds; every gradient falls to true black at the bottom.
 */
export function skyGradient(scene: Scene, phase: SkyPhase): string {
  const night = phase === "night" || phase === "astronomical";
  const twilight = phase === "nautical" || phase === "civil";
  const golden = phase === "golden";

  if (scene === "storm" || scene === "hail")
    return night
      ? "linear-gradient(180deg,#05070a 0%,#0b1310 45%,#000 100%)"
      : "linear-gradient(180deg,#0a0f0e 0%,#1b2a26 38%,#0b1110 72%,#000 100%)";
  if (scene === "cloudy" || scene === "drizzle" || scene === "rain" || scene === "freezing")
    return night
      ? "linear-gradient(180deg,#06080c 0%,#0e131a 50%,#000 100%)"
      : "linear-gradient(180deg,#121821 0%,#26303d 40%,#0d1117 75%,#000 100%)";
  if (scene === "snow")
    return night
      ? "linear-gradient(180deg,#070a12 0%,#141c2b 50%,#000 100%)"
      : "linear-gradient(180deg,#1a2230 0%,#3a4658 42%,#111720 78%,#000 100%)";
  if (scene === "fog")
    return "linear-gradient(180deg,#14171c 0%,#2a2f37 45%,#0e1013 80%,#000 100%)";

  // clear / partly
  if (night) return "linear-gradient(180deg,#01030a 0%,#050b1c 45%,#000 100%)";
  if (twilight) return "linear-gradient(180deg,#050b1f 0%,#1d2550 34%,#4a2a4e 58%,#120a14 82%,#000 100%)";
  if (golden) return "linear-gradient(180deg,#0a1a3a 0%,#2c3e74 30%,#a35a3c 58%,#2a1208 82%,#000 100%)";
  return "linear-gradient(180deg,#05244d 0%,#0d4a8a 34%,#1b5f9e 52%,#0a2238 78%,#000 100%)";
}

/** Glow colour of the sun/moon disc halo. */
export function luminaryGlow(phase: SkyPhase): string {
  if (phase === "golden") return "rgba(255,170,90,0.55)";
  if (phase === "civil" || phase === "nautical") return "rgba(255,120,140,0.35)";
  if (phase === "day") return "rgba(255,245,220,0.40)";
  return "rgba(200,215,255,0.22)"; // moon
}
