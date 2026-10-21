/** Messages between the main thread and the NEXRAD decode worker. */
import type { DecodedScaleId } from "../scales";
import type { Moment } from "./level2";
import type { Sweep } from "./sweep";

export type DecodeRequest =
  | { id: number; kind: "l3"; url: string; scale: DecodedScaleId }
  | { id: number; kind: "l2"; url: string; moment: Moment; angle: number; scale: DecodedScaleId; site?: { lat: number; lon: number } }
  /** A volume still being scanned: its real-time chunks, concatenated in order. */
  | { id: number; kind: "l2chunks"; urls: string[]; moment: Moment; angle: number; scale: DecodedScaleId }
  /** Every cut of one moment in a volume (the 3D view). */
  | { id: number; kind: "l2volume"; url: string; moment: Moment; site?: { lat: number; lon: number } };

export type DecodeResponse =
  | {
      id: number;
      ok: true;
      sweep: Sweep;
      /** RGBA per raw level in the scale's colours (alpha 0 = clear), for the GPU layer. */
      colors: Uint8Array;
      /** Level II: the volume's cut angles. */
      cuts: number[];
      /** The sweep ran to its end (a volume still arriving can hold part of one). */
      complete: boolean;
    }
  | { id: number; ok: false; error: string; empty?: boolean; cuts?: number[] };

/** The answer to an "l2volume" request: one sweep per elevation angle, lowest first. */
export type VolumeResponse = { id: number; ok: true; sweeps: Sweep[]; complete: boolean } | { id: number; ok: false; error: string };
