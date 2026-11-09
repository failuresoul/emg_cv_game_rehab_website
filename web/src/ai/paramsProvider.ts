import { createRng, type Rng } from "@/games/shared/rng";
import type { GameParams, ParamSpec, TrialHistoryEntry } from "@/games/shared/types";
import type { GameEngine, GameId } from "@/types/api";

/** Eight directions, 45 degrees apart, in the body frame: 0 is outward and 90 is up. */
export const DIRECTIONS_DEG = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/**
 * Chooses each trial's settings. FixedProvider (L0) is the only one until Day 12, when the
 * adaptive engines L1 and L2 arrive behind this same interface.
 */
export interface ParamsProvider {
  readonly engine: GameEngine;
  /** The settings for the next trial, given every earlier trial of this run, oldest first. */
  nextParams(gameId: GameId, history: readonly TrialHistoryEntry[]): GameParams;
}

export interface FixedProviderOptions {
  /** Each game's settings; their defaults are what this provider returns. */
  specsFor: (gameId: GameId) => readonly ParamSpec[];
  seed: number;
}

/**
 * L0: every setting at its default. For reach_activate it also sets `direction_index` and
 * `direction_deg`, visiting all eight directions in a shuffled order every eight trials, and never
 * the same direction twice in a row across two blocks.
 */
export class FixedProvider implements ParamsProvider {
  readonly engine = "L0";
  private readonly specsFor: (gameId: GameId) => readonly ParamSpec[];
  private readonly rng: Rng;
  /** Each block of eight trials' direction indices, generated as they are needed. */
  private readonly blocks: number[][] = [];

  constructor({ specsFor, seed }: FixedProviderOptions) {
    this.specsFor = specsFor;
    this.rng = createRng(seed);
  }

  nextParams(gameId: GameId, history: readonly TrialHistoryEntry[]): GameParams {
    const params: GameParams = Object.fromEntries(
      this.specsFor(gameId).map((spec) => [spec.name, spec.default]),
    );
    if (gameId === "reach_activate") {
      const index = this.directionFor(history.length);
      params.direction_index = index;
      params.direction_deg = DIRECTIONS_DEG[index];
    }
    return params;
  }

  /** The direction of the trial at this position, counting from 0. */
  private directionFor(position: number): number {
    const count = DIRECTIONS_DEG.length;
    const block = Math.floor(position / count);
    while (this.blocks.length <= block) {
      const order = this.rng.shuffle(DIRECTIONS_DEG.map((_, index) => index));
      const previous = this.blocks.at(-1)?.at(-1);
      if (order[0] === previous) {
        // Swap with any later direction, keeping the block a full set of eight.
        const swapWith = 1 + this.rng.int(0, count - 2);
        [order[0], order[swapWith]] = [order[swapWith], order[0]];
      }
      this.blocks.push(order);
    }
    return this.blocks[block][position % count];
  }
}
