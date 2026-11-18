"use client";

import { useSyncExternalStore } from "react";
import { DOT_COLS, DOT_ROWS, dotIconFor, dotsOf } from "@/lib/weather/dot-icons";
import { iconUrl } from "@/lib/weather/wmo";
import { cn } from "@/lib/utils";

/** Whether the active theme asks for dot-grid icons (<html data-icons="dot">, set by providers and the boot script). */
function subscribeIcons(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-icons"] });
  return () => mo.disconnect();
}
const dotSnapshot = () => document.documentElement.dataset.icons === "dot";

/**
 * Makin-Things weather icon. Rendered through <img> on purpose: each SVG
 * carries its own CSS keyframes and ids, and <img> sandboxes them so dozens
 * of animated icons never collide in the document. Themes with "icons": "dot"
 * get flat dot-grid icons instead (lib/weather/dot-icons), in the text colour.
 */
export function WeatherIcon({
  name,
  size = 48,
  animated = true,
  label,
  className,
  fluid = false,
}: {
  name: string;
  size?: number;
  animated?: boolean;
  label?: string;
  className?: string;
  /** Let `className` control the rendered width (responsive sizes). */
  fluid?: boolean;
}) {
  const dots = useSyncExternalStore(subscribeIcons, dotSnapshot, () => false);
  if (dots) {
    return (
      <svg
        viewBox={`0 0 ${DOT_COLS} ${DOT_ROWS}`}
        width={size}
        height={Math.round(size * 0.75)}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={cn("pointer-events-none shrink-0 select-none", className)}
        style={fluid ? { height: "auto" } : { width: size, height: "auto" }}
      >
        {dotsOf(dotIconFor(name)).map(([x, y, accent]) => (
          <circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.36} fill={accent ? "var(--color-accent)" : "var(--color-ink)"} />
        ))}
      </svg>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl(name, animated)}
      width={size}
      height={Math.round(size * 0.75)}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      decoding="async"
      className={cn("pointer-events-none shrink-0 select-none", className)}
      style={fluid ? { height: "auto" } : { width: size, height: "auto" }}
    />
  );
}
