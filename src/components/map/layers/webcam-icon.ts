/** Map image id of the camera badge for a marker colour. */
export const webcamIconId = (color: string) => `webcam-${color.replace("#", "")}`;

/** Logical size of the badge (px at icon-size 1); drawn at 2× so it stays crisp. */
export const WEBCAM_ICON_SIZE = 24;

/**
 * A live-camera marker: a round badge in the camera kind's colour with a dark
 * video-camera glyph and a dark rim, so it reads over basemaps and radar
 * colours alike. The glyph is dark because white would barely show on the
 * amber and light blue badges.
 */
export function webcamIcon(color: string): ImageData | null {
  const ratio = 2;
  const size = WEBCAM_ICON_SIZE * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const s = (v: number) => v * ratio;

  g.beginPath();
  g.arc(s(12), s(12), s(10.5), 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = s(1.5);
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.stroke();

  // Camera body and lens hood, centred: 6–18 across, 8.5–15.5 down.
  g.fillStyle = "#0b0f14";
  g.beginPath();
  g.roundRect(s(6), s(8.5), s(7.5), s(7), s(1.5));
  g.fill();
  g.beginPath();
  g.moveTo(s(13), s(11));
  g.lineTo(s(18), s(8.5));
  g.lineTo(s(18), s(15.5));
  g.lineTo(s(13), s(13));
  g.closePath();
  g.fill();
  return g.getImageData(0, 0, size, size);
}
