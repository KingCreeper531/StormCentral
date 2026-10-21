/**
 * The bubble behind a town's callout on a storm's path: dark, rounded, edged in
 * the warning's colour. MapLibre stretches it around the text (icon-text-fit),
 * keeping the corners as drawn.
 */
const RATIO = 2;
const SIZE = 24 * RATIO;
const RADIUS = 7 * RATIO;
const EDGE = 1.5 * RATIO;

export interface CalloutImage {
  data: ImageData;
  options: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] };
}

export function pathCallout(color: string): CalloutImage | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const inset = EDGE / 2;
  g.beginPath();
  g.roundRect(inset, inset, SIZE - EDGE, SIZE - EDGE, RADIUS);
  g.fillStyle = "rgba(9,13,22,0.92)";
  g.fill();
  g.lineWidth = EDGE;
  g.strokeStyle = color;
  g.stroke();
  return {
    data: g.getImageData(0, 0, SIZE, SIZE),
    options: { pixelRatio: RATIO, stretchX: [[RADIUS, SIZE - RADIUS]], stretchY: [[RADIUS, SIZE - RADIUS]], content: [RADIUS, RADIUS, SIZE - RADIUS, SIZE - RADIUS] },
  };
}
