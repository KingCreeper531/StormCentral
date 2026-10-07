/**
 * Upload hygiene for community photos — pure byte-level code, no native deps.
 *  - sniffImage: trust magic bytes, never the client's Content-Type.
 *  - stripMetadata: drop EXIF/XMP/IPTC/text chunks. Phone photos embed GPS
 *    coordinates; a spotter's home location must never leak via a photo.
 *  - imageSize: read dimensions from the container headers.
 */
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export function sniffImage(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

const ascii = (b: Uint8Array, off: number, len: number) => String.fromCharCode(...b.subarray(off, off + len));
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const u32le = (b: Uint8Array, o: number) => b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16) + ((b[o + 3]! << 24) >>> 0);
const u24le = (b: Uint8Array, o: number) => b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// JPEG APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) and COM (comments).
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) throw new Error("Corrupt JPEG");
    const marker = b[o + 1]!;
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      parts.push(b.subarray(o)); // SOS: entropy-coded data runs to EOI
      return concat(parts);
    }
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) throw new Error("Corrupt JPEG");
    if (!JPEG_DROP.has(marker)) parts.push(b.subarray(o, o + 2 + len));
    o += 2 + len;
  }
  parts.push(new Uint8Array([0xff, 0xd9]));
  return concat(parts);
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    const end = o + 12 + len;
    if (end > b.length) throw new Error("Corrupt PNG");
    if (!PNG_DROP.has(type)) parts.push(b.subarray(o, end));
    o = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}

function stripWebp(b: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let o = 12;
  while (o + 8 <= b.length) {
    const type = ascii(b, o, 4);
    const size = u32le(b, o + 4);
    const end = o + 8 + size + (size & 1);
    if (o + 8 + size > b.length) throw new Error("Corrupt WebP");
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(o, Math.min(end, b.length));
      if (type === "VP8X") chunk[8] = chunk[8]! & ~0x0c; // clear EXIF + XMP flags
      chunks.push(chunk);
    }
    o = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return concat([header, body]);
}

export function stripMetadata(b: Uint8Array, mime: ImageMime): Uint8Array {
  if (mime === "image/jpeg") return stripJpeg(b);
  if (mime === "image/png") return stripPng(b);
  return stripWebp(b);
}

export function imageSize(b: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === "image/png") return { width: u32be(b, 16), height: u32be(b, 20) };
    if (mime === "image/jpeg") {
      let o = 2;
      while (o + 9 < b.length) {
        const marker = b[o + 1]!;
        const len = u16be(b, o + 2);
        const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isSof) return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
        if (marker === 0xda) return null;
        o += 2 + len;
      }
      return null;
    }
    let o = 12;
    while (o + 8 <= b.length) {
      const type = ascii(b, o, 4);
      const size = u32le(b, o + 4);
      const d = o + 8;
      if (type === "VP8X") return { width: u24le(b, d + 4) + 1, height: u24le(b, d + 7) + 1 };
      if (type === "VP8 ") return { width: (b[d + 6]! | (b[d + 7]! << 8)) & 0x3fff, height: (b[d + 8]! | (b[d + 9]! << 8)) & 0x3fff };
      if (type === "VP8L") {
        const bits = u32le(b, d + 1);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      o = d + size + (size & 1);
    }
    return null;
  } catch {
    return null;
  }
}
