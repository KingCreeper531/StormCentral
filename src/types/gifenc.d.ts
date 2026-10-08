/**
 * Minimal types for gifenc 1.0 (MIT, https://github.com/mattdesl/gifenc),
 * which ships none. Only the parts the radar loop export uses.
 */
declare module "gifenc" {
  /** Colours as `[r, g, b]` (or `[r, g, b, a]` for the rgba4444 format), bytes 0–255. */
  export type GifPalette = number[][];
  export type GifColorFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface QuantizeOptions {
    format?: GifColorFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  /** Reduces RGBA pixels to at most `maxColors` palette entries. */
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): GifPalette;

  /** Maps each RGBA pixel to the index of its nearest palette colour (one byte per pixel). */
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: GifColorFormat): Uint8Array;

  export function nearestColorIndex(palette: GifPalette, pixel: number[]): number;

  export interface WriteFrameOptions {
    /** Required on the first frame (global colour table); a local table on later frames. */
    palette?: GifPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** Frame delay in ms (stored in 10 ms units). */
    delay?: number;
    /** -1 = play once, 0 = loop forever, n = n repeats. */
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeHeader(): void;
    writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
    finish(): void;
    /** A copy of the encoded bytes. */
    bytes(): Uint8Array<ArrayBuffer>;
    /** A view of the encoded bytes (no copy). */
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
    readonly buffer: ArrayBuffer;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
}
