import type { Finger } from "@/input/fingerTouch";

/** The same finger may come at most this many times in a row. */
export const MAX_REPEATS = 2;
/** How often the next note is a neighbour of the last, which keeps melodies simple to play. */
const NEIGHBOUR_SHARE = 0.6;

export interface MelodyRandom {
  /** From 0 (inclusive) to 1 (exclusive). */
  next(): number;
}

const pick = <T>(random: MelodyRandom, items: readonly T[]): T =>
  items[Math.min(items.length - 1, Math.floor(random.next() * items.length))];

/**
 * A simple melody of `length` notes on the given fingers. Every finger comes at least once when
 * the melody is long enough (otherwise as many different fingers as fit), steps to a neighbouring
 * finger are preferred, and no finger comes more than twice in a row.
 */
export function generateMelody(
  random: MelodyRandom,
  fingers: readonly Finger[],
  length: number,
): Finger[] {
  if (fingers.length === 0) return [];
  const count = Math.max(0, Math.floor(length));

  // Every finger once, in a shuffled order, so each is played.
  const order = [...fingers];
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random.next() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  const melody = order.slice(0, Math.min(count, order.length));

  while (melody.length < count) {
    const last = melody[melody.length - 1];
    const at = fingers.indexOf(last);
    const neighbours = [fingers[at - 1], fingers[at + 1]].filter(
      (finger): finger is Finger => finger !== undefined,
    );
    const repeatsLast =
      melody.length >= MAX_REPEATS && melody.slice(-MAX_REPEATS).every((finger) => finger === last);
    let options =
      random.next() < NEIGHBOUR_SHARE && neighbours.length > 0 ? neighbours : [...fingers];
    if (repeatsLast) options = options.filter((finger) => finger !== last);
    if (options.length === 0) options = fingers.filter((finger) => finger !== last);
    melody.push(pick(random, options));
  }
  return melody;
}

/** True when no finger comes more than `MAX_REPEATS` times in a row. */
export function respectsRepeats(melody: readonly Finger[]): boolean {
  let run = 1;
  for (let index = 1; index < melody.length; index++) {
    run = melody[index] === melody[index - 1] ? run + 1 : 1;
    if (run > MAX_REPEATS) return false;
  }
  return true;
}
