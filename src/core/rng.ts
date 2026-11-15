/** Small seeded PRNG (mulberry32). Same seed, same sequence, on every machine. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Waiting time until the next event of a Poisson process with the given rate per second. */
  exponential(ratePerSecond: number): number {
    if (ratePerSecond <= 0) return Infinity;
    return -Math.log(1 - this.next()) / ratePerSecond;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }
}

/**
 * A generator for one named stream within a seeded run, e.g. `streamRng(seed, 'veh:1>3')`.
 * Streams don't share state, so what happens in one never shifts the numbers another one sees.
 */
export function streamRng(seed: number, name: string): Rng {
  // FNV-1a over the name, mixed with the seed.
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return new Rng(h >>> 0);
}
