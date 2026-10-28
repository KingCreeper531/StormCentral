/**
 * Wind particles for the model maps: each one drifts with the interpolated
 * wind and leaves a short trail. Positions are kept in longitude and Mercator
 * Y (so wind lookups need no projection); trails are kept in screen pixels,
 * since that is all drawing needs. Flat typed arrays, no per-frame garbage.
 * Pure apart from the projection the caller supplies.
 */
import type { WindSampler } from "./grid";

/** Points kept per trail (the newest included). */
export const TRAIL = 16;
/** Screen pixels a particle moves per 60 Hz frame for each m/s of wind. */
const PX_PER_MS = 0.1;
/** Fastest a particle moves (px per 60 Hz frame), so hurricane cores don't streak across the map. */
const MAX_STEP = 3.5;
/** 60 Hz frames a particle lives, at least and at most (staggered so they don't all respawn at once). */
const LIFE_MIN = 40;
const LIFE_SPREAD = 70;

/** What the particles need from the map. */
export interface ParticleView {
  width: number;
  height: number;
  /** Screen pixels per degree of longitude at the current zoom. */
  pxPerDeg: number;
  /** Screen position of (lon, Mercator y) into `out` as [x, y]. */
  project: (lon: number, y: number, out: Float64Array) => void;
  /** A random place on screen into `out` as [lon, Mercator y]. */
  spawn: (out: Float64Array) => void;
}

export class Particles {
  readonly lon: Float64Array;
  readonly y: Float64Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  /** Trail ring per particle: TRAIL points of [x, y] screen pixels. */
  readonly trail: Float32Array;
  /** Points in each trail so far, and the slot of the newest. */
  readonly len: Uint8Array;
  readonly head: Uint8Array;
  private readonly wind = new Float64Array(2);
  private readonly pt = new Float64Array(2);

  constructor(
    readonly count: number,
    private readonly random: () => number = Math.random,
  ) {
    this.lon = new Float64Array(count);
    this.y = new Float64Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.trail = new Float32Array(count * TRAIL * 2);
    this.len = new Uint8Array(count);
    this.head = new Uint8Array(count);
    // Everything starts "dead" at a random age, so the first frames fill the screen gradually.
    for (let i = 0; i < count; i++) {
      this.life[i] = LIFE_MIN + Math.floor(random() * LIFE_SPREAD);
      this.age[i] = this.life[i]!;
    }
  }

  /** Forget every trail (the map moved, so screen positions are stale) and scatter the particles again. */
  reset(view: ParticleView) {
    for (let i = 0; i < this.count; i++) this.respawn(i, view, Math.floor(this.random() * LIFE_MIN));
  }

  /**
   * Advance every particle by `frames` 60 Hz frames (more than one when the
   * browser draws less often), so they move at the same speed everywhere.
   */
  step(wind: WindSampler, view: ParticleView, frames = 1) {
    const degPerPx = 1 / view.pxPerDeg;
    // A Mercator-Y radian spans as many pixels as 180/π degrees of longitude.
    const yPerPx = (degPerPx * Math.PI) / 180;
    for (let i = 0; i < this.count; i++) {
      if (this.age[i]! >= this.life[i]! || !wind.sample(this.lon[i]!, this.y[i]!, this.wind)) {
        this.respawn(i, view, 0);
        continue;
      }
      const u = this.wind[0]!;
      const v = this.wind[1]!;
      const speed = Math.hypot(u, v);
      const k = Math.min(PX_PER_MS, MAX_STEP / Math.max(speed, 1e-6)) * frames;
      this.lon[i] = this.lon[i]! + u * k * degPerPx;
      this.y[i] = this.y[i]! + v * k * yPerPx;
      this.age[i] = this.age[i]! + frames;
      view.project(this.lon[i]!, this.y[i]!, this.pt);
      const x = this.pt[0]!;
      const y = this.pt[1]!;
      if (!(x > -20 && y > -20 && x < view.width + 20 && y < view.height + 20)) {
        this.respawn(i, view, 0);
        continue;
      }
      this.push(i, x, y);
    }
  }

  /** Trail point `k` back from the newest (0 = newest) of particle `i`, as an index into `trail`. */
  point(i: number, k: number): number {
    return (i * TRAIL + ((this.head[i]! - k + TRAIL) % TRAIL)) * 2;
  }

  private push(i: number, x: number, y: number) {
    const h = (this.head[i]! + 1) % TRAIL;
    this.head[i] = h;
    this.trail[(i * TRAIL + h) * 2] = x;
    this.trail[(i * TRAIL + h) * 2 + 1] = y;
    if (this.len[i]! < TRAIL) this.len[i] = this.len[i]! + 1;
  }

  private respawn(i: number, view: ParticleView, age: number) {
    view.spawn(this.pt);
    this.lon[i] = this.pt[0]!;
    this.y[i] = this.pt[1]!;
    this.age[i] = age;
    this.life[i] = LIFE_MIN + Math.floor(this.random() * LIFE_SPREAD);
    this.len[i] = 0;
    view.project(this.lon[i]!, this.y[i]!, this.pt);
    this.push(i, this.pt[0]!, this.pt[1]!);
  }
}

/** How many particles suit a map of this size: one per ~`area` px², within `cap`. */
export function particleBudget(width: number, height: number, cap: number, area = 320): number {
  return Math.max(0, Math.min(cap, Math.round((width * height) / area)));
}
