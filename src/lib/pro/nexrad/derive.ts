/**
 * Level II products worked out from several moments of a volume, in the
 * decode worker: storm-relative velocity (srv.ts), NROT (nrot.ts) and the
 * debris probability with its signatures (tds.ts). Velocity is always
 * dealiased first for NROT and debris (a fold is a huge false shear); SRV
 * follows the Dealias velocity setting like base velocity.
 *
 * A volume's records are decompressed once for all its moments (Level2Options
 * `records`) while it's among the last two worked on; the products
 * themselves are kept a little longer, so another panel or a new storm
 * motion doesn't decode the volume again. The moments of a split cut come
 * from two scans with their own radials: each is looked up on the debris
 * field's grid (the dual-pol scan) by azimuth and range.
 */
import { dealiasSweep } from "./dealias";
import { parseLevel2, type Moment } from "./level2";
import { nrotField, nrotSweep } from "./nrot";
import { cloneSweep, encodeSweep, gateValues, resample } from "./polar";
import { stormRelative, type SrvMotion } from "./srv";
import type { Sweep } from "./sweep";
import { findTds, ptdsField, type TdsArea } from "./tds";

export type DeriveSpec = ({ kind: "srv" } & SrvMotion) | { kind: "nrot" } | { kind: "tds" };

/** Part of a frame's cache key: motions are rounded to what changes the picture (1°, 1 kt). */
export const deriveKey = (d: DeriveSpec) => (d.kind === "srv" ? `srv${Math.round(d.towardDeg) % 360}/${Math.round(d.speedKt)}` : d.kind);

/** A debris signature on the shown tilt, and every tilt checked that has one within MATCH_KM of it. */
export interface TdsMark extends Omit<TdsArea, "x" | "y"> {
  /** Elevation angles (°) it appears on, lowest first. */
  tilts: number[];
}

export interface DeriveResult {
  sweep: Sweep | null;
  cuts: number[];
  complete: boolean;
  marks?: TdsMark[];
  /** Why there's no sweep (no such cut, no dual-pol before 2011–13). */
  error?: string;
}

const MS_PER_KT = 1 / 1.943844;
/** Tilts above the shown one also checked for debris. */
const EXTRA_TILTS = 2;
/** A signature on another tilt within this (km, along the ground) is the same one. */
const MATCH_KM = 5;
/** Volumes whose records and moments stay decompressed. */
const LIVE_VOLUMES = 2;
const MAX_PRODUCTS = 24;

interface Parsed {
  sweep: Sweep | null;
  cuts: number[];
  complete: boolean;
}

interface VolumeCache {
  records: Map<number, Uint8Array>;
  moments: Map<string, Parsed>;
  /** NROT per tilt, on the velocity grid. */
  nrot: Map<number, { grid: Sweep; values: Float32Array } | null>;
  /** Debris field and areas per tilt. */
  tds: Map<number, { grid: Sweep; ptds: Float32Array; areas: TdsArea[] } | null>;
}

const caches = new WeakMap<Uint8Array, VolumeCache>();
const live: Uint8Array[] = [];
/** Finished products (cloned when sent): volume → key → result. */
const products = new Map<string, Map<string, DeriveResult>>();

function cacheOf(file: Uint8Array): VolumeCache {
  let c = caches.get(file);
  if (!c) caches.set(file, (c = { records: new Map(), moments: new Map(), nrot: new Map(), tds: new Map() }));
  const at = live.indexOf(file);
  if (at >= 0) live.splice(at, 1);
  live.push(file);
  // Older volumes let go of their decompressed data (their finished products stay below).
  while (live.length > LIVE_VOLUMES) caches.delete(live.shift()!);
  return c;
}

function moment(file: Uint8Array, c: VolumeCache, m: Moment, angle: number, site: { lat: number; lon: number } | undefined, dealias = false): Parsed {
  const key = `${m}|${angle}${dealias ? "|da" : ""}`;
  let p = c.moments.get(key);
  if (!p) {
    if (dealias) {
      const raw = moment(file, c, m, angle, site);
      p = { ...raw, sweep: raw.sweep && dealiasSweep(raw.sweep) };
    } else {
      const r = parseLevel2(file, m, angle, { site, records: c.records });
      p = { sweep: r.sweep, cuts: r.cuts.map((x) => x.angle), complete: r.complete };
    }
    c.moments.set(key, p);
  }
  return p;
}

function nrotAt(file: Uint8Array, c: VolumeCache, angle: number, site: { lat: number; lon: number } | undefined) {
  if (!c.nrot.has(angle)) {
    const vel = moment(file, c, "VEL", angle, site, true).sweep;
    c.nrot.set(angle, vel ? { grid: vel, values: nrotField(vel) } : null);
  }
  return c.nrot.get(angle)!;
}

function tdsAt(file: Uint8Array, c: VolumeCache, angle: number, site: { lat: number; lon: number } | undefined) {
  if (!c.tds.has(angle)) {
    const rho = moment(file, c, "RHO", angle, site).sweep;
    const zdr = moment(file, c, "ZDR", angle, site).sweep;
    const ref = moment(file, c, "REF", angle, site).sweep;
    if (!rho || !zdr || !ref) c.tds.set(angle, null);
    else {
      const rot = nrotAt(file, c, angle, site);
      const sw = moment(file, c, "SW", angle, site).sweep;
      c.tds.set(angle, debris({ ref, rho, zdr, sw, nrot: rot }));
    }
  }
  return c.tds.get(angle)!;
}

/**
 * The debris field on the CC scan's gates and its signatures, from one
 * tilt's moments (each on its own scan's grid; velocity's NROT with it).
 */
export function debris(m: { ref: Sweep; rho: Sweep; zdr: Sweep; sw: Sweep | null; nrot: { grid: Sweep; values: Float32Array } | null }): { grid: Sweep; ptds: Float32Array; areas: TdsArea[] } {
  const grid = m.rho;
  const nrot = m.nrot ? resample(m.nrot.values, m.nrot.grid, grid) : null;
  const sw = m.sw ? resample(gateValues(m.sw, MS_PER_KT), m.sw, grid) : null;
  const ptds = ptdsField(resample(gateValues(m.ref), m.ref, grid), gateValues(grid), resample(gateValues(m.zdr), m.zdr, grid), nrot, sw);
  return { grid, ptds, areas: findTds(grid, ptds, nrot) };
}

/** The volume's distinct cut angles above `angle`, lowest first. */
const higher = (cuts: readonly number[], angle: number, n: number) =>
  [...new Set(cuts.map((a) => Math.round(a * 10) / 10))].filter((a) => a > angle + 0.25).sort((a, b) => a - b).slice(0, n);

function compute(file: Uint8Array, angle: number, spec: DeriveSpec, opts: { site?: { lat: number; lon: number }; dealias?: boolean }): DeriveResult {
  const c = cacheOf(file);
  const site = opts.site;
  if (spec.kind === "srv") {
    const p = moment(file, c, "VEL", angle, site, !!opts.dealias);
    return { ...p, sweep: p.sweep && stormRelative(p.sweep, spec), error: p.sweep ? undefined : "No such cut in this volume" };
  }
  if (spec.kind === "nrot") {
    const p = moment(file, c, "VEL", angle, site, true);
    const rot = nrotAt(file, c, angle, site);
    return { cuts: p.cuts, complete: p.complete, sweep: rot && nrotSweep(rot.grid, rot.values), error: rot ? undefined : "No such cut in this volume" };
  }
  const p = moment(file, c, "RHO", angle, site);
  const shown = tdsAt(file, c, angle, site);
  if (!shown) {
    // Reflectivity but no CC: a volume from before the dual-pol upgrade.
    const legacy = !!moment(file, c, "REF", angle, site).sweep;
    return { cuts: p.cuts, complete: p.complete, sweep: null, error: legacy ? "This volume has no dual-pol data" : "No such cut in this volume" };
  }
  // The same signatures on the next tilts up: how deep the debris reaches (only worth decoding when there's one).
  const above = (shown.areas.length ? higher(p.cuts, angle, EXTRA_TILTS) : []).map((a) => ({ angle: a, areas: tdsAt(file, c, a, site)?.areas ?? [] }));
  return { cuts: p.cuts, complete: p.complete, sweep: encodeSweep(shown.grid, shown.ptds, 0, 100, 1), marks: markTilts(shown.grid.elevation, shown.areas, above) };
}

/** The shown tilt's signatures as marks, each with the tilts (of those checked above it) that have one within MATCH_KM. */
export function markTilts(elevation: number, areas: readonly TdsArea[], above: readonly { angle: number; areas: readonly TdsArea[] }[]): TdsMark[] {
  return areas.map(({ x, y, ...a }): TdsMark => {
    const tilts = [elevation];
    for (const t of above) if (t.areas.some((b) => Math.hypot(b.x - x, b.y - y) <= MATCH_KM)) tilts.push(t.angle);
    return { ...a, tilts };
  });
}

/**
 * A derived product of the cut at `angle` (±0.25°) of a Level II volume
 * (`volume` names it for the cache: its address, or its chunks so far). The
 * sweep is the caller's to move to another thread.
 */
export function deriveLevel2(
  file: Uint8Array,
  volume: string,
  angle: number,
  spec: DeriveSpec,
  opts: { site?: { lat: number; lon: number }; dealias?: boolean } = {},
): DeriveResult {
  const key = `${angle}|${deriveKey(spec)}${opts.dealias ? "|da" : ""}`;
  let byKey = products.get(volume);
  let r = byKey?.get(key);
  if (!r) {
    r = compute(file, angle, spec, opts);
    if (!byKey) products.set(volume, (byKey = new Map()));
    byKey.set(key, r);
    // A bounded number of products, oldest volumes first.
    let n = 0;
    for (const m of products.values()) n += m.size;
    for (const [f, m] of products) {
      if (n <= MAX_PRODUCTS || f === volume) break;
      n -= m.size;
      products.delete(f);
    }
  }
  return { ...r, sweep: r.sweep && cloneSweep(r.sweep), marks: r.marks?.map((m) => ({ ...m, tilts: [...m.tilts] })) };
}
