/** Messages between the main thread and the NEXRAD decode worker. */
import type { DecodedScaleId, ValueScale } from "../scales";
import type { DeriveSpec, TdsMark } from "./derive";
import type { Moment } from "./level2";
import type { Sweep } from "./sweep";

export type DecodeRequest =
  | { id: number; kind: "l3"; url: string; scale: DecodedScaleId }
  /** `dealias`: unfold folded velocities (dealias.ts). `derive`: a product worked out from the volume instead (derive.ts). */
  | { id: number; kind: "l2"; url: string; moment: Moment; angle: number; scale: DecodedScaleId; site?: { lat: number; lon: number }; dealias?: boolean; derive?: DeriveSpec }
  /** A volume still being scanned: its real-time chunks, concatenated in order. */
  | { id: number; kind: "l2chunks"; urls: string[]; moment: Moment; angle: number; scale: DecodedScaleId; dealias?: boolean; derive?: DeriveSpec }
  /** Every cut of one moment in a volume (the 3D view). */
  | { id: number; kind: "l2volume"; url: string; moment: Moment; site?: { lat: number; lon: number; heightM?: number } }
  /** Max value trails over a loop's sweeps, oldest first (trail.ts), coloured on `scale`. */
  | { id: number; kind: "trail"; key: string; sweeps: Sweep[]; signed: boolean; scale: ValueScale & { clearBelow?: boolean } };

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
      /** Debris signatures (derived "tds" products). */
      marks?: TdsMark[];
    }
  | { id: number; ok: false; error: string; empty?: boolean; cuts?: number[] };

/** The answer to an "l2volume" request: one sweep per elevation angle, lowest first. */
export type VolumeResponse = { id: number; ok: true; sweeps: Sweep[]; complete: boolean } | { id: number; ok: false; error: string };

/** The answer to a "trail" request: each volume's trail so far, and its colours. */
export type TrailResponse = { id: number; ok: true; sweeps: Sweep[]; colors: Uint8Array[] } | { id: number; ok: false; error: string };
