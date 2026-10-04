/**
 * Deterministic pseudo-random number generation.
 *
 * Every generator and simulation system draws from a named stream derived from
 * the world seed, so "same seed + same inputs = same world" holds across runs
 * and across save/load boundaries (nothing depends on transient RNG state).
 */

/** FNV-1a style string hash producing a 32-bit unsigned integer. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Combine parts into a single 32-bit seed. */
export function makeSeed(...parts: Array<string | number>): number {
  return hashString(parts.join('::'));
}

export interface WeightedEntry<T> {
  value: T;
  weight: number;
}

export class Rng {
  private state: number;
  readonly seed: number;

  constructor(seed: number | string) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.state = this.seed || 0x9e3779b9;
  }

  /**
   * Re-seed in place, to the same state `new Rng(seed)` would start from.
   *
   * The match engine draws from one generator per fixed step, and a fresh object
   * for every step of a match is a lot of garbage for the collector to carry.
   * Resetting the same generator to the step's seed produces exactly the numbers
   * the constructor would have, so the football is unchanged and the allocation
   * is gone.
   */
  reset(seed: number): void {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with an empty array');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Pick with replacement using weights; weights need not sum to 1. */
  weighted<T>(entries: readonly WeightedEntry<T>[]): T {
    const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (total <= 0) throw new Error('Rng.weighted called with no positive weights');
    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= Math.max(0, entry.weight);
      if (roll <= 0) return entry.value;
    }
    return entries[entries.length - 1]!.value;
  }

  /** Fisher-Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = a;
    }
    return copy;
  }

  /**
   * Roughly normal distribution via the sum of uniforms.
   * `mean` and `spread` operate in the caller's units.
   */
  gaussian(mean: number, spread: number): number {
    const sum = this.next() + this.next() + this.next() + this.next() + this.next() + this.next();
    // sum has mean 3, sd ~ 0.707; scale to mean/spread.
    return mean + ((sum - 3) / 0.7071) * spread;
  }

  /** Integer gaussian, clamped to [min, max]. */
  gaussianInt(mean: number, spread: number, min: number, max: number): number {
    const value = Math.round(this.gaussian(mean, spread));
    return Math.max(min, Math.min(max, value));
  }
}

/** A named RNG stream, so unrelated systems never consume each other's numbers. */
export function stream(seed: string | number, ...label: Array<string | number>): Rng {
  return new Rng(makeSeed(String(seed), ...label));
}
