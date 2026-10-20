/** Messages between the main thread and the NEXRAD decode worker. */
import type { DecodedScaleId } from "../scales";
import type { Moment } from "./level2";
import type { Sweep } from "./sweep";

export type DecodeRequest =
  | { id: number; kind: "l3"; url: string; scale: DecodedScaleId; maxPx: number }
  | { id: number; kind: "l2"; url: string; moment: Moment; angle: number; scale: DecodedScaleId; maxPx: number; site?: { lat: number; lon: number } };

export type DecodeResponse =
  | {
      id: number;
      ok: true;
      image: Blob;
      bounds: [number, number, number, number];
      sweep: Sweep;
      /** Level II: the volume's cut angles. */
      cuts: number[];
    }
  | { id: number; ok: false; error: string; empty?: boolean; cuts?: number[] };
