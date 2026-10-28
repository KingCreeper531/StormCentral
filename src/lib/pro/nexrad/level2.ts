/**
 * NEXRAD Level II (Archive II) decoder for one elevation cut of one moment,
 * after the RDA/RPG ICD (2620002) and Unidata's archive format: a 24-byte
 * volume header, then LDM records (a 4-byte length and a bzip2 stream each)
 * holding Message 31 radials, or (older archive files, once gunzipped) the
 * same messages uncompressed. Volumes from before the 2008 upgrade hold
 * Message 1 radials instead (reflectivity on 1 km gates, velocity and
 * spectrum width on 250 m, no site location). MetPy's Level2File was the
 * reference.
 *
 * Decoding stops as soon as the requested cut is complete, so low tilts cost
 * a fraction of the volume. The cut list comes from the VCP (Message 5) in
 * the first record. `parseLevel2Volume` reads every cut of a moment in one
 * pass instead (the 3D view).
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
  /** The cut ran to its end (a volume still arriving in chunks may hold only part of it). */
  complete: boolean;
  /** Records or messages that couldn't be read and were skipped (a damaged file still shows the rest). */
  damaged: number;
}

export interface Level2Options {
  /** Where the radar is, for volumes that don't say (Message 1, before 2008). */
  site?: { lat: number; lon: number; heightM?: number };
}

/** Message 1 moments: which gate set they're on, and raw level → value (value = (level − offset) / scale). */
const MSG1 = {
  REF: { doppler: false, scale: 2, offset: 66 },
  VEL: { doppler: true, scale: 2, offset: 129 },
  SW: { doppler: true, scale: 2, offset: 129 },
} as const;
const BAM = 180 / 32768;

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** The cuts of an uncompressed Message 1 volume, in scan order, from its radials' elevation numbers. */
function legacyCuts(file: Uint8Array): Level2Cut[] {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const cuts: Level2Cut[] = [];
  for (let p = 24; p + CTM + 16 + 18 <= file.length; p += FRAME) {
    if (!dv.getUint16(p + CTM) || dv.getUint8(p + CTM + 3) !== 1) continue;
    const o = p + CTM + 16;
    const n = dv.getUint16(o + 16);
    if (n >= 1 && n <= 40 && !cuts[n - 1]) cuts[n - 1] = { angle: Math.round(dv.getUint16(o + 14) * BAM * 100) / 100 };
  }
  return Array.from(cuts, (c) => c ?? { angle: NaN }).filter((c) => !Number.isNaN(c.angle));
}

interface Radial {
  az: number;
  spacing: number;
  gates: number;
  first: number;
  width: number;
  wordBits: number;
  scale: number;
  offset: number;
  /** Nyquist velocity, m/s (0: not given). */
  nyquist: number;
  data: Uint8Array;
}

/** Sanity limits: past these a header is corrupt, not a radar (super-res has 1832 gates and 720 radials a cut). */
const MAX_GATES = 2048;
const MAX_RADIALS = 1500;

/** One cut's radials as they're read. */
interface CutRadials {
  angle: number;
  radials: Radial[];
  complete: boolean;
}

interface Decoded {
  site: string;
  time: number;
  vcp: number | null;
  cuts: Level2Cut[];
  lat: number;
  lon: number;
  heightM: number;
  /** Elevation number → its radials, in the order the cuts were met. */
  groups: Map<number, CutRadials>;
  damaged: number;
}

/**
 * Decode the first cut at `angle` (±0.25°) that carries `moment`. With
 * `angle` null only the cut list is read.
 */
export function parseLevel2(file: Uint8Array, moment: Moment, angle: number | null, opts: Level2Options = {}): Level2Result {
  const d = decodeLevel2(file, moment, angle, opts);
  const cut = d.groups.values().next().value as CutRadials | undefined;
  const built = cut && buildSweep(d, cut, moment);
  return { site: d.site, time: d.time, vcp: d.vcp, cuts: d.cuts, sweep: built?.sweep ?? null, complete: cut?.complete ?? false, damaged: d.damaged + (built?.damaged ?? 0) };
}

export interface Level2VolumeResult extends Omit<Level2Result, "sweep" | "complete"> {
  /** One sweep per elevation angle that carries the moment, lowest first (a repeated angle, like SAILS, keeps its first scan). */
  sweeps: Sweep[];
  /** The volume ran to its end. */
  complete: boolean;
}

/** Every cut of `moment` in the volume, decoded in one pass. */
export function parseLevel2Volume(file: Uint8Array, moment: Moment, opts: Level2Options = {}): Level2VolumeResult {
  const d = decodeLevel2(file, moment, "all", opts);
  const byAngle = new Map<number, Sweep>();
  let damaged = d.damaged;
  for (const cut of d.groups.values()) {
    const built = buildSweep(d, cut, moment);
    damaged += built.damaged;
    const key = Math.round(built.sweep.elevation * 10);
    // The first scan at an angle, unless it was cut well short and a later one wasn't.
    const prev = byAngle.get(key);
    if (!prev || prev.nRadials < built.sweep.nRadials * 0.9) byAngle.set(key, built.sweep);
  }
  const sweeps = [...byAngle.values()].sort((a, b) => a.elevation - b.elevation);
  const last = [...d.groups.values()].at(-1);
  return { site: d.site, time: d.time, vcp: d.vcp, cuts: d.cuts, sweeps, complete: !!last?.complete, damaged };
}

function decodeLevel2(file: Uint8Array, moment: Moment, angle: number | null | "all", opts: Level2Options): Decoded {
  const all = angle === "all";
  const head = new DataView(file.buffer, file.byteOffset, 24);
  // "ARCHIVE2." before about 2000.
  if (ascii(file, 0, 4) !== "AR2V" && ascii(file, 0, 8) !== "ARCHIVE2") throw new Error("Not an Archive II file");
  const time = (head.getUint32(12) - 1) * 86_400_000 + head.getUint32(16);
  const site = ascii(file, 20, 4);
  const dvFile = new DataView(file.buffer, file.byteOffset, file.byteLength);

  const cuts: Level2Cut[] = [];
  let vcp: number | null = null;
  let lat = 0;
  let lon = 0;
  let heightM = 0;
  let targetEl = -1;
  let done = false;
  let damaged = 0;
  const groups = new Map<number, CutRadials>();
  /** A radial of the moment for cut `elNum`: the first such cut is the target unless every cut is wanted. */
  const accept = (elNum: number, elAngle: number, r: Radial, status: number) => {
    let g = groups.get(elNum);
    if (!g) {
      if (!all && targetEl >= 0) return;
      targetEl = elNum;
      g = { angle: cuts[elNum - 1]?.angle ?? elAngle, radials: [], complete: false };
      groups.set(elNum, g);
    }
    if (g.radials.length >= MAX_RADIALS) return;
    g.radials.push(r);
    // 2 = end of elevation, 4 = end of volume.
    if (status === 2 || status === 4) {
      g.complete = true;
      if (!all) done = true;
    }
  };

  const handleMsg31 = (m: Uint8Array, dv: DataView, o: number) => {
    // o = start of the Message 31 data header (after the 16-byte message header).
    const azAngle = dv.getFloat32(o + 12);
    const spacing = dv.getUint8(o + 20) === 1 ? 0.5 : 1;
    const status = dv.getUint8(o + 21);
    const elNum = dv.getUint8(o + 22);
    const elAngle = dv.getFloat32(o + 24);
    const blocks = dv.getUint16(o + 30);
    if (!all) {
      if (targetEl >= 0 && elNum !== targetEl) {
        if (elNum > targetEl) done = true;
        return;
      }
      if (angle == null) return;
      // Match on the VCP's nominal angle for this cut (radial angles wander while the antenna settles).
      const nominal = cuts[elNum - 1]?.angle ?? elAngle;
      if (Math.abs(nominal - angle) > 0.25) return;
    }
    let found: Radial | null = null;
    let nyquist = 0;
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
      } else if (type === 0x52 && name === "RAD") {
        nyquist = dv.getInt16(p + 16) / 100;
      } else if (type === 0x44 && name === moment) {
        const gates = dv.getUint16(p + 8);
        const wordBits = dv.getUint8(p + 19);
        const bytes = (gates * wordBits) / 8;
        // A block that claims more than the message holds (or nonsense sizes) is damage, not data.
        if ((wordBits !== 8 && wordBits !== 16) || !gates || gates > MAX_GATES || p + 28 + bytes > m.length) {
          damaged++;
          continue;
        }
        found = {
          az: azAngle,
          spacing,
          gates,
          first: dv.getUint16(p + 10) / 1000,
          width: dv.getUint16(p + 12) / 1000,
          wordBits,
          scale: dv.getFloat32(p + 20),
          offset: dv.getFloat32(p + 24),
          nyquist: 0,
          data: m.slice(p + 28, p + 28 + bytes),
        };
      }
    }
    if (found) accept(elNum, elAngle, { ...found, nyquist }, status);
  };

  const handleMsg1 = (m: Uint8Array, dv: DataView, o: number) => {
    // o = start of the Message 1 body; offsets to the moments' data count from there.
    const status = dv.getUint16(o + 12);
    const elNum = dv.getUint16(o + 16);
    if (!all && targetEl >= 0 && elNum !== targetEl) {
      if (elNum > targetEl) done = true;
      return;
    }
    if (angle == null) return;
    const def = MSG1[moment as keyof typeof MSG1];
    if (!def) return;
    const elAngle = dv.getUint16(o + 14) * BAM;
    const nominal = cuts[elNum - 1]?.angle ?? elAngle;
    if (!all && Math.abs(nominal - angle) > 0.25) return;
    const gates = dv.getUint16(o + (def.doppler ? 28 : 26));
    if (!gates) return;
    const ptr = dv.getUint16(o + (moment === "REF" ? 36 : moment === "VEL" ? 38 : 40));
    if (gates > MAX_GATES || o + ptr + gates > m.length) {
      damaged++;
      return;
    }
    // Velocity resolution: 2 = 0.5 m/s steps, 4 = 1 m/s.
    const fine = moment !== "VEL" || dv.getUint16(o + 42) !== 4;
    vcp ||= dv.getUint16(o + 44) || null;
    const radial: Radial = {
      az: dv.getUint16(o + 8) * BAM,
      spacing: 1,
      gates,
      first: dv.getInt16(o + (def.doppler ? 20 : 18)) / 1000,
      width: dv.getUint16(o + (def.doppler ? 24 : 22)) / 1000,
      wordBits: 8,
      scale: fine ? def.scale : 1,
      offset: def.offset,
      nyquist: dv.getUint16(o + 60) / 100,
      data: m.slice(o + ptr, o + ptr + gates),
    };
    accept(elNum, elAngle, radial, status);
  };

  const handleMsg5 = (dv: DataView, o: number) => {
    const n = dv.getUint16(o + 6);
    // Older archives carry an empty one.
    if (!n) return;
    vcp = dv.getUint16(o + 4);
    for (let i = 0; i < n && i < 40; i++) {
      const raw = dv.getUint16(o + 22 + i * 46);
      cuts.push({ angle: Math.round(((raw * 360) / 65536) * 100) / 100 });
    }
  };

  /** The messages in one record (or in a whole uncompressed file). */
  const readMessages = (rec: Uint8Array) => {
    const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    let p = 0;
    while (p + CTM + 16 <= rec.length && !done) {
      const sizeHw = dv.getUint16(p + CTM);
      const type = dv.getUint8(p + CTM + 3);
      let bytes = FRAME;
      if (sizeHw) {
        if (sizeHw === 65535) bytes = ((dv.getUint16(p + CTM + 12) << 16) | dv.getUint16(p + CTM + 14)) + CTM;
        else if (type === 31 || type === 29) bytes = CTM + 2 * sizeHw;
        // One bad message (a pointer past its end, a cut-off radial) loses that message, not the volume.
        try {
          if (type === 31) handleMsg31(rec, dv, p + CTM + 16);
          else if (type === 1) handleMsg1(rec, dv, p + CTM + 16);
          else if (type === 5 && !cuts.length) handleMsg5(dv, p + CTM + 16);
        } catch {
          damaged++;
        }
      }
      p += Math.max(CTM + 16, bytes);
    }
  };

  // Files from the NCEI archive before about 2016 (gunzipped) hold the messages uncompressed
  // after the volume header; newer ones hold LDM records, each a length and a bzip2 stream.
  const compressed = ascii(file, 28, 3) === "BZh";
  if (!compressed) readMessages(file.subarray(24));
  let pos = 24;
  while (compressed && pos + 4 <= file.length && !done) {
    const size = Math.abs(dvFile.getInt32(pos));
    pos += 4;
    // A record cut short is the end of what's arrived (a download dropped, a volume still coming in).
    if (!size || pos + size > file.length) break;
    // A corrupt record loses its radials (a wedge of the sweep), not the volume.
    let rec: Uint8Array | null = null;
    try {
      rec = bunzip2(file.subarray(pos, pos + size), size * 8);
    } catch {
      damaged++;
    }
    if (rec) readMessages(rec);
    pos += size;
    // Only the cut list was wanted: it's in the first (metadata) record.
    if (angle == null && cuts.length) break;
  }

  // Older archives' scan pattern message is empty: the cut list comes from the radials themselves.
  if (!cuts.length && !compressed) cuts.push(...legacyCuts(file));
  // Message 1 doesn't say where the radar is.
  if (!lat && opts.site) [lat, lon, heightM] = [opts.site.lat, opts.site.lon, opts.site.heightM ?? 0];
  return { site, time, vcp, cuts, lat, lon, heightM, groups, damaged };
}

/** One cut's radials as a sweep. One gate geometry and scaling per sweep: a radial that disagrees with the first is damaged. */
function buildSweep(d: Decoded, cut: CutRadials, moment: Moment): { sweep: Sweep; damaged: number } {
  const ref = cut.radials[0]!;
  const radials = cut.radials.filter((r) => r.first === ref.first && r.width === ref.width && r.scale === ref.scale && r.offset === ref.offset && r.wordBits === ref.wordBits);
  const damaged = cut.radials.length - radials.length;
  const nRadials = radials.length;
  const nGates = Math.max(...radials.map((r) => r.gates));
  const wide = ref.wordBits === 16;
  const data = wide ? new Uint16Array(nRadials * nGates) : new Uint8Array(nRadials * nGates);
  const azStart = new Float32Array(nRadials);
  const azWidth = new Float32Array(nRadials);
  radials.forEach((r, i) => {
    azStart[i] = (r.az - r.spacing / 2 + 360) % 360;
    azWidth[i] = r.spacing;
    if (r.wordBits === 16) {
      const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      for (let g = 0; g < Math.min(r.gates, r.data.byteLength >> 1); g++) data[i * nGates + g] = dv.getUint16(g * 2);
    } else data.set(r.data.subarray(0, r.gates), i * nGates);
  });
  const levels = wide ? 65536 : 256;
  const table = new Float32Array(levels).fill(NaN);
  const k = moment === "VEL" || moment === "SW" ? MS_TO_KT : 1;
  for (let i = 2; i < levels; i++) table[i] = ((i - ref.offset) / ref.scale) * k;
  // Velocity: each radial's Nyquist velocity, for dealiasing (only when every radial gives one).
  const nyquist = moment === "VEL" && radials.every((r) => r.nyquist > 0) ? Float32Array.from(radials, (r) => r.nyquist * k) : undefined;

  return {
    damaged,
    sweep: {
      lat: d.lat,
      lon: d.lon,
      heightM: d.heightM,
      time: d.time,
      elevation: Math.round(cut.angle * 100) / 100,
      nRadials,
      nGates,
      firstGateKm: ref.first,
      gateKm: ref.width,
      azStart,
      azWidth,
      data,
      table,
      special: [{ level: 1, label: "RF" }],
      ...(nyquist && { nyquist }),
    },
  };
}
