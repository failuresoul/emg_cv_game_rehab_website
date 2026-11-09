import type { TranslationKey } from "@/i18n";

import type { GameFeedback } from "./types";

/** Short, positive messages after a success. */
export const SUCCESS_KEYS: readonly TranslationKey[] = [
  "encourage.success.wellDone",
  "encourage.success.nice",
  "encourage.success.great",
  "encourage.success.goodMove",
  "encourage.success.lovely",
];
/** Said after every few successes in a row, with the count. */
export const STREAK_KEYS: readonly TranslationKey[] = [
  "encourage.streak.inARow",
  "encourage.streak.keepGoing",
];
/** Calm messages after a miss: never blame, always look ahead. */
export const MISS_KEYS: readonly TranslationKey[] = [
  "encourage.miss.nextOne",
  "encourage.miss.takeYourTime",
  "encourage.miss.thatsOk",
  "encourage.miss.tryAnother",
];

/** A streak message every this many successes in a row: 3, 6, 9 … */
export const STREAK_EVERY = 3;

/**
 * Picks a short message after each trial: a positive one after a success, a streak message after
 * every third success in a row, and a calm one after a miss. The same message never comes twice
 * in a row. `random` gives numbers from 0 to 1, such as a game's seeded rng.
 */
export class Encourager {
  private readonly random: () => number;
  private streak = 0;
  private last: TranslationKey | null = null;

  constructor(random: () => number) {
    this.random = random;
  }

  /** Successes in a row so far. */
  get currentStreak(): number {
    return this.streak;
  }

  success(): GameFeedback {
    this.streak++;
    if (this.streak % STREAK_EVERY === 0) {
      return { key: this.pick(STREAK_KEYS), params: { n: this.streak }, tone: "positive" };
    }
    return { key: this.pick(SUCCESS_KEYS), tone: "positive" };
  }

  miss(): GameFeedback {
    this.streak = 0;
    return { key: this.pick(MISS_KEYS), tone: "gentle" };
  }

  private pick(keys: readonly TranslationKey[]): TranslationKey {
    const choices = keys.length > 1 ? keys.filter((key) => key !== this.last) : keys;
    const index = Math.min(choices.length - 1, Math.floor(this.random() * choices.length));
    this.last = choices[index];
    return this.last;
  }
}
