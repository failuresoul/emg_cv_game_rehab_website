/** A seeded random number generator, so a run can be repeated exactly from its seed. */
export interface Rng {
  readonly seed: number;
  /** From 0 (included) to 1 (excluded). */
  next(): number;
  /** A whole number from min to max, both included. */
  int(min: number, max: number): number;
  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Mulberry32: small, fast and good enough for games. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: seed >>> 0,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

/** A seed for a new run. */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}
