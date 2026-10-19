/**
 * NEXRAD Level III product decoder (radial digital products, packet 16),
 * after the RPG-to-Class-1-User ICD (2620001): message header, product
 * description block, optional bzip2-compressed symbology. Value scaling
 * follows each product's threshold halfwords; MetPy's Level3File was used
 * as the reference when checking real files.
 *
 * Supported: 94/153 reflectivity, 99/154 velocity, 159 ZDR, 161 CC, 163 KDP,
 * 165/177 hydrometeor class, 134 digital VIL, 135 enhanced echo tops.
 */
import { bunzip2 } from "./bzip2";
import type { Sweep } from "./sweep";

export const L3_CODES = [94, 99, 134, 135, 153, 154, 159, 161, 163, 165, 177] as const;

/** Gate spacing by product (the packet's range scale field isn't reliable for digital products). */
const GATE_KM: Record<number, number> = { 94: 1, 134: 1, 135: 1, 99: 0.25, 153: 0.25, 154: 0.25, 159: 0.25, 161: 0.25, 163: 0.25, 165: 0.25, 177: 0.25 };

const MS_TO_KT = 1.943844;

/** NEXRAD's 16-bit float: sign, 5-bit exponent (bias 16), 10-bit fraction. */
export function float16(v: number): number {
  const frac = v & 0x3ff;
  const exp = (v >> 10) & 0x1f;
  const value = exp ? 2 ** (exp - 16) * (1 + frac / 1024) : frac / 512;
  return v & 0x8000 ? -value : value;
}

/** IEEE float32 from two big-endian halfwords. */
export function float32(hi: number, lo: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint16(0, hi & 0xffff);
  dv.setUint16(2, lo & 0xffff);
  return dv.getFloat32(0);
}

const signed16 = (v: number) => (v & 0x8000 ? v - 0x10000 : v);

/** Raw level → value for a product, from its 16 threshold halfwords. Also the special levels. */
export function valueTable(code: number, thr: readonly number[]): { table: Float32Array; special: { level: number; label: string }[] } {
  const table = new Float32Array(256).fill(NaN);
  const special: { level: number; label: string }[] = [];
  switch (code) {
    case 94:
    case 153:
    case 99:
    case 154: {
      const min = signed16(thr[0]!) / 10;
      const inc = thr[1]! / 10;
      const levels = Math.min(thr[2]!, 254);
      const k = code === 99 || code === 154 ? MS_TO_KT : 1;
      for (let i = 0; i < levels; i++) table[i + 2] = (min + i * inc) * k;
      if (code === 99 || code === 154) special.push({ level: 1, label: "RF" });
      break;
    }
    case 159:
    case 161:
    case 163: {
      const scale = float32(thr[0]!, thr[1]!);
      const offset = float32(thr[2]!, thr[3]!);
      const max = thr[5]!;
      const leading = thr[6]!;
      for (let i = leading; i <= max && i < 256; i++) table[i] = (i - offset) / scale;
      special.push({ level: 1, label: "RF" });
      break;
    }
    case 165:
    case 177:
      // Classes in tens: 10 BI … 120 GH, 140 UK; 150 is range folded.
      for (let i = 10; i < 150; i++) table[i] = Math.floor(i / 10);
      special.push({ level: 150, label: "RF" });
      break;
    case 134: {
      const linScale = float16(thr[0]!);
      const linOffset = float16(thr[1]!);
      const logStart = thr[2]!;
      const logScale = float16(thr[3]!);
      const logOffset = float16(thr[4]!);
      for (let i = 2; i < 255; i++) table[i] = i < logStart ? (i - linOffset) / linScale : Math.exp((i - logOffset) / logScale);
      break;
    }
    case 135: {
      const mask = thr[0]!;
      const scale = thr[1]! || 1;
      const offset = thr[2]!;
      for (let i = 2; i < 256; i++) table[i] = ((i & mask) - offset) / scale;
      break;
    }
    default:
      throw new Error(`Level III product ${code} isn't supported`);
  }
  return { table, special };
}

export interface Level3Product extends Sweep {
  code: number;
  /** Radar's 3-letter id from the text header, when present. */
  site: string | null;
}

/** Decode a Level III file (with or without its WMO/AWIPS text header). */
export function parseLevel3(file: Uint8Array): Level3Product {
  let off = 0;
  let site: string | null = null;
  // "SDUS54 KOUN 191552\r\r\nN0CTLX\r\r\n"
  if (file[0] === 0x53 && file[1] === 0x44 && file[2] === 0x55 && file[3] === 0x53) {
    let lines = 0;
    for (let i = 0; i < Math.min(file.length - 2, 64); i++) {
      if (file[i] === 0x0d && file[i + 1] === 0x0d && file[i + 2] === 0x0a) {
        if (lines === 1) site = String.fromCharCode(file[i - 3]!, file[i - 2]!, file[i - 1]!);
        lines++;
        i += 2;
        off = i + 1;
        if (lines === 2) break;
      }
    }
  }
  let msg = file.subarray(off);
  let dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  const code = dv.getInt16(0);
  if (!(L3_CODES as readonly number[]).includes(code)) throw new Error(`Level III product ${code} isn't supported`);

  // Product description block (halfwords 10–60 of the message).
  const P = 18;
  const lat = dv.getInt32(P + 2) / 1000;
  const lon = dv.getInt32(P + 6) / 1000;
  const heightM = dv.getInt16(P + 10) * 0.3048;
  const volDate = dv.getUint16(P + 22);
  const volTime = dv.getUint32(P + 24);
  const elevation = code === 134 || code === 135 ? 0 : dv.getInt16(P + 40) / 10;
  const thr = Array.from({ length: 16 }, (_, i) => dv.getUint16(P + 42 + i * 2));
  const compression = dv.getInt16(P + 82);
  const symOffset = dv.getUint32(P + 90) * 2;
  if (!symOffset) throw new Error("Level III file has no symbology block");

  if (compression === 1) {
    const head = msg.subarray(0, P + 102);
    const body = bunzip2(msg.subarray(P + 102), dv.getUint32(P + 84));
    const joined = new Uint8Array(head.length + body.length);
    joined.set(head);
    joined.set(body, head.length);
    msg = joined;
    dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  }

  // Symbology block → first layer → packet 16 (digital radial data array).
  let p = symOffset;
  if (dv.getInt16(p) !== -1 || dv.getInt16(p + 2) !== 1) throw new Error("Level III symbology block not found");
  p += 10; // divider, block id, length (4), layer count
  p += 6; // layer divider + layer length
  const packet = dv.getUint16(p);
  if (packet !== 16) throw new Error(`Level III packet ${packet.toString(16)} isn't supported`);
  const firstBin = dv.getInt16(p + 2);
  const nGates = dv.getInt16(p + 4);
  const nRadials = dv.getInt16(p + 12);
  p += 14;
  const data = new Uint8Array(nRadials * nGates);
  const azStart = new Float32Array(nRadials);
  const azWidth = new Float32Array(nRadials);
  for (let r = 0; r < nRadials; r++) {
    const bytes = dv.getInt16(p);
    azStart[r] = dv.getInt16(p + 2) / 10;
    azWidth[r] = dv.getInt16(p + 4) / 10;
    p += 6;
    data.set(msg.subarray(p, p + Math.min(bytes, nGates)), r * nGates);
    p += bytes + (bytes & 1);
  }
  const gateKm = GATE_KM[code]!;
  const { table, special } = valueTable(code, thr);
  return {
    code,
    site,
    lat,
    lon,
    heightM,
    time: (volDate - 1) * 86_400_000 + volTime * 1000,
    elevation,
    nRadials,
    nGates,
    firstGateKm: (firstBin + 0.5) * gateKm,
    gateKm,
    azStart,
    azWidth,
    data,
    table,
    special,
  };
}
