import { iconUrl } from "@/lib/weather/wmo";
import { cn } from "@/lib/utils";

/**
 * Makin-Things weather icon. Rendered through <img> on purpose: each SVG
 * carries its own CSS keyframes and ids, and <img> sandboxes them so dozens
 * of animated icons never collide in the document.
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
