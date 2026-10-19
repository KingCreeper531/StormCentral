/**
 * NEXRAD Level II (Archive II) decoder for one elevation cut of one moment,
 * after the RDA/RPG ICD (2620002) and Unidata's archive format: a 24-byte
 * volume header, then LDM records (a 4-byte length and a bzip2 stream each)
 * holding Message 31 radials. MetPy's Level2File was the reference.
 *
 * Decoding stops as soon as the requested cut is complete, so low tilts cost
 * a fraction of the volume. The cut list comes from the VCP (Message 5) in
 * the first record.
 */
import { bunzip2 } from "./bzip2";
import type { Sweep } from "./sweep";

export type Moment = "REF" | "VEL" | "ZDR" | "RHO" | "PHI" | "SW";

const MS_TO_KT = 1.943844;
const CTM = 12;
const FRAME = 2432;

export interface Level2Cut {
  /** Elevation angle (deg) from the VCP. */
  angle: number;
}

export interface Level2Result {
  site: string;
  /** Volume start, epoch ms. */
  time: number;
  vcp: number | null;
  /** The volume's cuts, in scan order (repeats included, e.g. SAILS 0.5° cuts). */
  cuts: Level2Cut[];
  sweep: Sweep | null;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

interface Radial {
  az: number;
  spacing: number;
  gates: number;
  first: number;
  width: number;
  wordBits: number;
  scale: number;
  offset: number;
  data: Uint8Array;
}

/**
 * Decode the first cut at `angle` (±0.25°) that carries `moment`. With
 * `angle` null only the cut list is read.
 */
export function parseLevel2(file: Uint8Array, moment: Moment, angle: number | null): Level2Result {
  const head = new DataView(file.buffer, file.byteOffset, 24);
  if (ascii(file, 0, 4) !== "AR2V") throw new Error("Not an Archive II file");
  const time = (head.getUint32(12) - 1) * 86_400_000 + head.getUint32(16);
  const site = ascii(file, 20, 4);
  const dvFile = new DataView(file.buffer, file.byteOffset, file.byteLength);

  const cuts: Level2Cut[] = [];
  let vcp: number | null = null;
  let lat = 0;
  let lon = 0;
  let heightM = 0;
  let targetEl = -1;
  let cutAngle = 0;
  let done = false;
  const radials: Radial[] = [];

  const handleMsg31 = (m: Uint8Array, dv: DataView, o: number) => {
    // o = start of the Message 31 data header (after the 16-byte message header).
    const azAngle = dv.getFloat32(o + 12);
    const spacing = dv.getUint8(o + 20) === 1 ? 0.5 : 1;
    const status = dv.getUint8(o + 21);
    const elNum = dv.getUint8(o + 22);
    const elAngle = dv.getFloat32(o + 24);
    const blocks = dv.getUint16(o + 30);
    if (targetEl >= 0 && elNum !== targetEl) {
      if (elNum > targetEl) done = true;
      return;
    }
    if (angle == null) return;
    // Match on the VCP's nominal angle for this cut (radial angles wander while the antenna settles).
    const nominal = cuts[elNum - 1]?.angle ?? elAngle;
    if (Math.abs(nominal - angle) > 0.25) return;
    let found: Radial | null = null;
    for (let b = 0; b < blocks; b++) {
      const ptr = dv.getUint32(o + 32 + b * 4);
      if (!ptr) continue;
      const p = o + ptr;
      const type = m[p];
      const name = ascii(m, p + 1, 3).trim();
      if (type === 0x52 && name === "VOL" && !lat) {
        lat = dv.getFloat32(p + 8);
        lon = dv.getFloat32(p + 12);
        heightM = dv.getInt16(p + 16) + dv.getUint16(p + 18);
        vcp ??= dv.getUint16(p + 40);
      } else if (type === 0x44 && name === moment) {
        const gates = dv.getUint16(p + 8);
        const wordBits = dv.getUint8(p + 19);
        const bytes = (gates * wordBits) / 8;
        found = {
          az: azAngle,
          spacing,
          gates,
          first: dv.getUint16(p + 10) / 1000,
          width: dv.getUint16(p + 12) / 1000,
          wordBits,
          scale: dv.getFloat32(p + 20),
          offset: dv.getFloat32(p + 24),
          data: m.slice(p + 28, p + 28 + bytes),
        };
      }
    }
    if (!found) return;
    if (targetEl < 0) {
      targetEl = elNum;
      cutAngle = cuts[elNum - 1]?.angle ?? elAngle;
    }
    radials.push(found);
    // 2 = end of elevation, 4 = end of volume.
    if (status === 2 || status === 4) done = true;
  };

  const handleMsg5 = (dv: DataView, o: number) => {
    const n = dv.getUint16(o + 6);
    vcp = dv.getUint16(o + 4);
    for (let i = 0; i < n && i < 40; i++) {
      const raw = dv.getUint16(o + 22 + i * 46);
      cuts.push({ angle: Math.round(((raw * 360) / 65536) * 100) / 100 });
    }
  };

  let pos = 24;
  while (pos + 4 <= file.length && !done) {
    const size = Math.abs(dvFile.getInt32(pos));
    pos += 4;
    if (!size || pos + size > file.length) break;
    const rec = bunzip2(file.subarray(pos, pos + size), size * 8);
    pos += size;
    const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    let p = 0;
    while (p + CTM + 16 <= rec.length && !done) {
      const sizeHw = dv.getUint16(p + CTM);
      const type = dv.getUint8(p + CTM + 3);
      let bytes = FRAME;
      if (sizeHw) {
        if (sizeHw === 65535) bytes = ((dv.getUint16(p + CTM + 12) << 16) | dv.getUint16(p + CTM + 14)) + CTM;
        else if (type === 31 || type === 29) bytes = CTM + 2 * sizeHw;
        if (type === 31) handleMsg31(rec, dv, p + CTM + 16);
        else if (type === 5 && !cuts.length) handleMsg5(dv, p + CTM + 16);
      }
      p += bytes;
    }
    // Only the cut list was wanted: it's in the first (metadata) record.
    if (angle == null && cuts.length) break;
  }

  if (!radials.length) return { site, time, vcp, cuts, sweep: null };

  const nRadials = radials.length;
  const nGates = Math.max(...radials.map((r) => r.gates));
  const wide = radials.some((r) => r.wordBits === 16);
  const data = wide ? new Uint16Array(nRadials * nGates) : new Uint8Array(nRadials * nGates);
  const azStart = new Float32Array(nRadials);
  const azWidth = new Float32Array(nRadials);
  radials.forEach((r, i) => {
    azStart[i] = (r.az - r.spacing / 2 + 360) % 360;
    azWidth[i] = r.spacing;
    if (r.wordBits === 16) {
      const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      for (let g = 0; g < r.gates; g++) data[i * nGates + g] = dv.getUint16(g * 2);
    } else data.set(r.data.subarray(0, r.gates), i * nGates);
  });
  const ref = radials[0]!;
  const levels = wide ? 65536 : 256;
  const table = new Float32Array(levels).fill(NaN);
  const k = moment === "VEL" || moment === "SW" ? MS_TO_KT : 1;
  for (let i = 2; i < levels; i++) table[i] = ((i - ref.offset) / ref.scale) * k;

  return {
    site,
    time,
    vcp,
    cuts,
    sweep: {
      lat,
      lon,
      heightM,
      time,
      elevation: Math.round(cutAngle * 100) / 100,
      nRadials,
      nGates,
      firstGateKm: ref.first,
      gateKm: ref.width,
      azStart,
      azWidth,
      data,
      table,
      special: [{ level: 1, label: "RF" }],
    },
  };
}
