/**
 * Broadcast mode's Pro view (components/broadcast/broadcast-pro-stage.tsx):
 * Professional mode's panels on air in place of the radar map, under the
 * same graphics.
 */

/**
 * Whether the control bar offers the Pro view, and whether it shows. Only
 * while Professional mode is on in Settings: turning it off brings back the
 * radar map, and turning it on again brings back the saved choice.
 */
export function proView(professional: boolean, saved: boolean): { available: boolean; on: boolean } {
  return { available: professional, on: professional && saved };
}

export interface Insets {
  top: number;
  bottom: number;
}

/**
 * How far the graphics reach in from the top and bottom of the screen, from
 * their boxes (offsets within the overlay, in px), so the Pro workspace's
 * toolbars can sit clear of them. A box in the top half counts from the top
 * (the station bug, the clock), one in the bottom half from the bottom (the
 * lower third, the ticker); hidden ones (no height) not at all.
 */
export function overlayInsets(boxes: readonly { top: number; height: number }[], height: number, gap = 8): Insets {
  let top = 0;
  let bottom = 0;
  for (const b of boxes) {
    if (b.height <= 0) continue;
    if (b.top + b.height / 2 < height / 2) top = Math.max(top, b.top + b.height + gap);
    else bottom = Math.max(bottom, height - b.top + gap);
  }
  return { top: Math.round(top), bottom: Math.round(bottom) };
}
