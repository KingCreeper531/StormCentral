import { describe, expect, it } from "vitest";
import { imageSize, sniffImage, stripMetadata } from "./image";

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe("image hygiene", () => {
  it("strips EXIF from JPEG and reads its size", () => {
    const exif = bytes(0xff, 0xe1, 0x00, 0x0c, "Exif", 0, 0, "GPS!");
    const app0 = bytes(0xff, 0xe0, 0x00, 0x04, 1, 2);
    const sof = bytes(0xff, 0xc0, 0x00, 0x0b, 8, 0x00, 0x02, 0x00, 0x03, 1, 1, 0x11, 0);
    const sos = bytes(0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xff, 0xd9);
    const jpeg = new Uint8Array([...bytes(0xff, 0xd8), ...exif, ...app0, ...sof, ...sos]);
    expect(sniffImage(jpeg)).toBe("image/jpeg");
    const out = stripMetadata(jpeg, "image/jpeg");
    expect(Buffer.from(out).includes(Buffer.from("Exif"))).toBe(false);
    expect(out.length).toBe(jpeg.length - exif.length);
    expect(imageSize(out, "image/jpeg")).toEqual({ width: 3, height: 2 });
  });

  it("drops anything after a JPEG's end-of-image marker", () => {
    const sof = bytes(0xff, 0xc0, 0x00, 0x0b, 8, 0x00, 0x02, 0x00, 0x03, 1, 1, 0x11, 0);
    // Entropy-coded data with a stuffed FF (FF 00) and a restart marker (FF D0), both part of the scan.
    const scan = bytes(0xff, 0xda, 0x00, 0x02, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56);
    const image = new Uint8Array([...bytes(0xff, 0xd8), ...sof, ...scan, 0xff, 0xd9]);
    const trailer = bytes("PK", 3, 4, "<script>alert(1)</script>", 0xff, 0xe1, 0x00, 0x08, "Exif", 0, 0, 0xff, 0xd9);
    const out = stripMetadata(new Uint8Array([...image, ...trailer]), "image/jpeg");
    expect(Buffer.from(out).equals(Buffer.from(image))).toBe(true);
  });

  it("walks a progressive JPEG's scans instead of stopping at the first FF D9 byte pair", () => {
    const sof = bytes(0xff, 0xc2, 0x00, 0x0b, 8, 0x00, 0x02, 0x00, 0x03, 1, 1, 0x11, 0);
    const scan1 = bytes(0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb);
    // A table between the scans whose data happens to hold FF D9: not an end-of-image marker.
    const dqt = bytes(0xff, 0xdb, 0x00, 0x06, 0x00, 0xff, 0xd9, 0x01);
    const exifBetween = bytes(0xff, 0xe1, 0x00, 0x08, "Exif", 0, 0);
    const scan2 = bytes(0xff, 0xda, 0x00, 0x02, 0xcc, 0xff, 0x00, 0xdd);
    const jpeg = new Uint8Array([...bytes(0xff, 0xd8), ...sof, ...scan1, ...dqt, ...exifBetween, ...scan2, 0xff, 0xd9, ...bytes("trailing")]);
    const out = stripMetadata(jpeg, "image/jpeg");
    const expected = new Uint8Array([...bytes(0xff, 0xd8), ...sof, ...scan1, ...dqt, ...scan2, 0xff, 0xd9]);
    expect(Buffer.from(out).equals(Buffer.from(expected))).toBe(true);
    expect(imageSize(out, "image/jpeg")).toEqual({ width: 3, height: 2 });
  });

  it("ends a JPEG cut off mid-scan with an end-of-image marker", () => {
    const sof = bytes(0xff, 0xc0, 0x00, 0x0b, 8, 0x00, 0x02, 0x00, 0x03, 1, 1, 0x11, 0);
    const jpeg = new Uint8Array([...bytes(0xff, 0xd8), ...sof, ...bytes(0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff)]);
    const out = stripMetadata(jpeg, "image/jpeg");
    expect(Buffer.from(out).equals(Buffer.from(new Uint8Array([...jpeg, 0xff, 0xd9])))).toBe(true);
  });

  it("strips text chunks from PNG", () => {
    const chunk = (type: string, data: number[]) => bytes(0, 0, 0, data.length, type, ...data, 0, 0, 0, 0);
    const png = new Uint8Array([
      ...bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      ...chunk("IHDR", [0, 0, 0, 5, 0, 0, 0, 7, 8, 6, 0, 0, 0]),
      ...chunk("tEXt", [65, 66]),
      ...chunk("IDAT", [1]),
      ...chunk("IEND", []),
    ]);
    const out = stripMetadata(png, "image/png");
    expect(Buffer.from(out).includes(Buffer.from("tEXt"))).toBe(false);
    expect(imageSize(out, "image/png")).toEqual({ width: 5, height: 7 });
  });

  it("strips EXIF from WebP, clears VP8X flags and fixes RIFF size", () => {
    const vp8x = bytes("VP8X", 10, 0, 0, 0, 0x08, 0, 0, 0, 99, 0, 0, 49, 0, 0);
    const exif = bytes("EXIF", 3, 0, 0, 0, 1, 2, 3, 0);
    const vp8l = bytes("VP8L", 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0);
    const body = [...bytes("WEBP"), ...vp8x, ...exif, ...vp8l];
    const webp = new Uint8Array([...bytes("RIFF"), body.length, 0, 0, 0, ...body]);
    expect(sniffImage(webp)).toBe("image/webp");
    const out = stripMetadata(webp, "image/webp");
    expect(Buffer.from(out).includes(Buffer.from("EXIF"))).toBe(false);
    expect(out[20]! & 0x08).toBe(0);
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    expect(imageSize(out, "image/webp")).toEqual({ width: 100, height: 50 });
  });

  it("rejects non-images", () => {
    expect(sniffImage(bytes("<svg>"))).toBeNull();
    expect(sniffImage(bytes("GIF89a"))).toBeNull();
  });
});
