/** Logical size of the wave arrow (px at icon-size 1); drawn at 2× so it stays crisp. */
export const WAVE_ARROW_SIZE = 18;

/**
 * A wave direction arrow pointing up (north, before the layer rotates it):
 * a white shaft and head on a dark outline, so it reads over every colour of
 * the wave field and the basemap.
 */
export function waveArrowIcon(): ImageData | null {
  const ratio = 2;
  const size = WAVE_ARROW_SIZE * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const s = (v: number) => v * ratio;

  g.beginPath();
  g.moveTo(s(9), s(2.5));
  g.lineTo(s(13.5), s(8));
  g.lineTo(s(10.25), s(8));
  g.lineTo(s(10.25), s(15.5));
  g.lineTo(s(7.75), s(15.5));
  g.lineTo(s(7.75), s(8));
  g.lineTo(s(4.5), s(8));
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = s(2);
  g.strokeStyle = "rgba(0,0,0,0.75)";
  g.stroke();
  g.fillStyle = "#ffffff";
  g.fill();
  return g.getImageData(0, 0, size, size);
}
