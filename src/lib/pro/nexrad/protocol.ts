/** Messages between the main thread and the NEXRAD decode worker. */
import type { DecodedScaleId } from "../scales";
import type { Moment } from "./level2";
import type { Sweep } from "./sweep";

export type DecodeRequest =
  | { id: number; kind: "l3"; url: string; scale: DecodedScaleId; maxPx: number }
  | { id: number; kind: "l2"; url: string; moment: Moment; angle: number; scale: DecodedScaleId; maxPx: number; site?: { lat: number; lon: number } }
  /** A volume still being scanned: its real-time chunks, concatenated in order. */
  | { id: number; kind: "l2chunks"; urls: string[]; moment: Moment; angle: number; scale: DecodedScaleId; maxPx: number };

export type DecodeResponse =
  | {
      id: number;
      ok: true;
      image: Blob;
      bounds: [number, number, number, number];
      sweep: Sweep;
      /** Level II: the volume's cut angles. */
      cuts: number[];
      /** The sweep ran to its end (a volume still arriving can hold part of one). */
      complete: boolean;
    }
  | { id: number; ok: false; error: string; empty?: boolean; cuts?: number[] };
