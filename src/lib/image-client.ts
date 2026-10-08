/**
 * Browser-side photo preparation: decode (honouring EXIF orientation),
 * downscale to ≤1600 px, and re-encode to WebP (JPEG fallback). Re-encoding
 * through a canvas drops *all* metadata — including GPS — before upload.
 */
export async function preparePhoto(file: File, maxDim = 1600): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encode = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  let blob = await encode("image/webp", 0.82);
  // Browsers that can't encode WebP silently return PNG — prefer JPEG then.
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.85);
  if (!blob) throw new Error("Couldn't encode image");
  return { blob, width, height };
}
