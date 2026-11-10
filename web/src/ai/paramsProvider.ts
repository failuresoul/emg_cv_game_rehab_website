import { generateMelody } from "@/games/fingerPiano/melody";
import { activeFingers, MAX_SEQUENCE_LENGTH, melodyToParams } from "@/games/fingerPiano/params";
import { createRng, type Rng } from "@/games/shared/rng";
import { PATH_SHAPES } from "@/metrics/paths";
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
  /**
   * The settings for a trial, given every finished trial of this run, oldest first. `trialNo`
   * (from 1) defaults to the trial after the history; games where trials overlap pass it.
   */
  nextParams(gameId: GameId, history: readonly TrialHistoryEntry[], trialNo?: number): GameParams;
}

export interface FixedProviderOptions {
  /** Each game's settings; their defaults are what this provider returns. */
  specsFor: (gameId: GameId) => readonly ParamSpec[];
  seed: number;
  /**
   * The patient's own starting values, which replace a setting's default, such as the touch
   * distance from their warm-up. None by default.
   */
  defaultsFor?: (gameId: GameId) => GameParams;
}

/** Balloon Pop's upward directions: up-and-out, straight up, up-and-across. */
export const BALLOON_DIRECTIONS_DEG = [45, 90, 135] as const;
/** Balloon Pop's heights, as shares of the calibrated reach in the balloon's direction. */
export const BALLOON_HEIGHT_FRACS = [0.55, 0.7, 0.85] as const;
/** Every direction with every height: nine balloons a block. */
const BALLOON_COMBOS = BALLOON_DIRECTIONS_DEG.flatMap((directionDeg) =>
  BALLOON_HEIGHT_FRACS.map((heightFrac) => ({ directionDeg, heightFrac })),
);
/** Fruit Catch's distances, as shares of the spread on each side. */
export const FRUIT_TARGET_FRACS = [0.4, 0.7, 1.0] as const;

/**
 * L0: every setting at its default, plus where each target goes:
 *
 * - reach_activate: `direction_index` and `direction_deg`, all eight directions in a shuffled
 *   order every eight trials.
 * - balloon_pop: `direction_deg`, `direction_index` and `height_frac`, every pairing of three
 *   upward directions and three heights in a shuffled order every nine trials.
 * - fruit_catch: `target_side` (1 out, -1 across), alternating from out, and `target_frac`, each
 *   side's three distances in a shuffled order every three fruits on that side.
 * - path_trace: `shape_index` cycling through the four shapes and `direction` (1 outward, -1
 *   inward) alternating, so each shape is traced both ways every eight trials.
 * - finger_piano: a melody as `note_1` … `note_n` (0 index to 3 little finger), from
 *   generateMelody: every active finger, mostly neighbouring steps, never three in a row.
 *
 * The same choice never comes twice in a row across two blocks.
 */
export class FixedProvider implements ParamsProvider {
  readonly engine = "L0";
  private readonly specsFor: (gameId: GameId) => readonly ParamSpec[];
  private readonly defaultsFor: (gameId: GameId) => GameParams;
  private readonly rng: Rng;
  /** Blocks of shuffled choices (indices), by game or game and side, made as they are needed. */
  private readonly blocks = new Map<string, number[][]>();

  constructor({ specsFor, seed, defaultsFor = () => ({}) }: FixedProviderOptions) {
    this.specsFor = specsFor;
    this.defaultsFor = defaultsFor;
    this.rng = createRng(seed);
  }

  nextParams(
    gameId: GameId,
    history: readonly TrialHistoryEntry[],
    trialNo = history.length + 1,
  ): GameParams {
    const personal = this.defaultsFor(gameId);
    const params: GameParams = Object.fromEntries(
      this.specsFor(gameId).map((spec) => [
        spec.name,
        Number.isFinite(personal[spec.name]) ? personal[spec.name] : spec.default,
      ]),
    );
    const position = Math.max(0, trialNo - 1);
    if (gameId === "reach_activate") {
      const index = this.choiceFor(gameId, position, DIRECTIONS_DEG.length);
      params.direction_index = index;
      params.direction_deg = DIRECTIONS_DEG[index];
    } else if (gameId === "balloon_pop") {
      const combo = BALLOON_COMBOS[this.choiceFor(gameId, position, BALLOON_COMBOS.length)];
      params.direction_deg = combo.directionDeg;
      params.direction_index = combo.directionDeg / 45;
      params.height_frac = combo.heightFrac;
    } else if (gameId === "fruit_catch") {
      const out = position % 2 === 0;
      const index = this.choiceFor(
        `${gameId}:${out ? "out" : "across"}`,
        Math.floor(position / 2),
        FRUIT_TARGET_FRACS.length,
      );
      params.target_side = out ? 1 : -1;
      params.target_frac = FRUIT_TARGET_FRACS[index];
    } else if (gameId === "path_trace") {
      // Every shape in turn; each shape gets both directions over two rounds.
      params.shape_index = position % PATH_SHAPES.length;
      params.direction = (position + Math.floor(position / PATH_SHAPES.length)) % 2 === 0 ? 1 : -1;
    } else if (gameId === "finger_piano") {
      const length = Math.min(MAX_SEQUENCE_LENGTH, Math.max(1, Math.round(params.sequence_length)));
      const melody = generateMelody(this.rng, activeFingers(params.finger_count), length);
      Object.assign(params, melodyToParams(melody));
    }
    return params;
  }

  /** Which of `count` choices the trial at this position gets, counting from 0. */
  private choiceFor(key: string, position: number, count: number): number {
    const blocks = this.blocks.get(key) ?? [];
    this.blocks.set(key, blocks);
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
