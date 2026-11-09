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

/** Balloon Pop's upward directions: up-and-out, straight up, up-and-across. */
export const BALLOON_DIRECTIONS_DEG = [45, 90, 135] as const;
/** Balloon Pop's heights, as shares of the calibrated reach in the balloon's direction. */
export const BALLOON_HEIGHT_FRACS = [0.55, 0.7, 0.85] as const;
/** Every direction with every height: nine balloons a block. */
const BALLOON_COMBOS = BALLOON_DIRECTIONS_DEG.flatMap((directionDeg) =>
  BALLOON_HEIGHT_FRACS.map((heightFrac) => ({ directionDeg, heightFrac })),
);

/**
 * L0: every setting at its default, plus where each target goes:
 *
 * - reach_activate: `direction_index` and `direction_deg`, all eight directions in a shuffled
 *   order every eight trials.
 * - balloon_pop: `direction_deg`, `direction_index` and `height_frac`, every pairing of three
 *   upward directions and three heights in a shuffled order every nine trials.
 *
 * In both, the same choice never comes twice in a row across two blocks.
 */
export class FixedProvider implements ParamsProvider {
  readonly engine = "L0";
  private readonly specsFor: (gameId: GameId) => readonly ParamSpec[];
  private readonly rng: Rng;
  /** Each game's blocks of shuffled choices (indices), generated as they are needed. */
  private readonly blocks = new Map<GameId, number[][]>();

  constructor({ specsFor, seed }: FixedProviderOptions) {
    this.specsFor = specsFor;
    this.rng = createRng(seed);
  }

  nextParams(gameId: GameId, history: readonly TrialHistoryEntry[]): GameParams {
    const params: GameParams = Object.fromEntries(
      this.specsFor(gameId).map((spec) => [spec.name, spec.default]),
    );
    if (gameId === "reach_activate") {
      const index = this.choiceFor(gameId, history.length, DIRECTIONS_DEG.length);
      params.direction_index = index;
      params.direction_deg = DIRECTIONS_DEG[index];
    } else if (gameId === "balloon_pop") {
      const combo = BALLOON_COMBOS[this.choiceFor(gameId, history.length, BALLOON_COMBOS.length)];
      params.direction_deg = combo.directionDeg;
      params.direction_index = combo.directionDeg / 45;
      params.height_frac = combo.heightFrac;
    }
    return params;
  }

  /** Which of `count` choices the trial at this position gets, counting from 0. */
  private choiceFor(gameId: GameId, position: number, count: number): number {
    const blocks = this.blocks.get(gameId) ?? [];
    this.blocks.set(gameId, blocks);
    const block = Math.floor(position / count);
    while (blocks.length <= block) {
      const order = this.rng.shuffle(Array.from({ length: count }, (_, index) => index));
      const previous = blocks.at(-1)?.at(-1);
      if (order[0] === previous && count > 1) {
        // Swap with any later choice, keeping the block a full set.
        const swapWith = 1 + this.rng.int(0, count - 2);
        [order[0], order[swapWith]] = [order[swapWith], order[0]];
      }
      blocks.push(order);
    }
    return blocks[block][position % count];
  }
}
