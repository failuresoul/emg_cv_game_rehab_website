import { type Point, projectOnDirection } from "@/vision/geometry";

import { type DirectionResult, DIRECTIONS_DEG } from "./calibration";

export const SWEEP_MS = 20_000;
/** A short reach is enough to light a star, so that everyone gets to see them light up. */
export const STAR_LIGHTS_AT_SW = 0.6;
/** Where the stars are drawn. */
export const STAR_DISTANCE_SW = 1;

// Each direction takes movements within 45 degrees of it, so a star never lights from far away.
const SECTOR_HALF_WIDTH_DEG = 45;
// Keeps going a little after the last star, so that people can still reach further.
const AFTER_LAST_STAR_MS = 3000;
// The clock stops while the arm is out of view, so this ends a game that can never finish.
const MAX_REAL_TIME_MS = 45_000;
const LOST_AFTER_MS = 500;

export interface SweepFrame {
  timestamp: number;
  /** The raw wrist position in the body frame, or null if it is not visible. */
  wristSw: Point | null;
  trunkSw: Point | null;
  shoulderWidthPx: number | null;
}

export interface SweepUpdate {
  /** Directions whose star lit up on this frame. */
  newlyLit: number[];
  isFinished: boolean;
  isArmLost: boolean;
  secondsLeft: number;
}

function angleDifference(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

/**
 * One calibration: the arm moves freely for a while, and each direction keeps its furthest reach.
 * Uses raw positions. A reach must last two frames in a row, so a single bad frame cannot count.
 */
export class ReachSweep {
  private readonly best: (number | null)[] = DIRECTIONS_DEG.map(() => null);
  private readonly lit: boolean[] = DIRECTIONS_DEG.map(() => false);
  private previous: (number | null)[] = DIRECTIONS_DEG.map(() => null);
  private startedAt: number | null = null;
  private lastFrameAt = 0;
  private lastSeenAt = 0;
  private activeMs = 0;
  private allLitAtActiveMs: number | null = null;
  private maxTrunkSw = 0;
  private shoulderWidthPx: number | null = null;

  get litFlags(): readonly boolean[] {
    return this.lit;
  }

  get litCount(): number {
    return this.lit.filter(Boolean).length;
  }

  add({ timestamp, wristSw, trunkSw, shoulderWidthPx }: SweepFrame): SweepUpdate {
    if (this.startedAt === null) {
      this.startedAt = timestamp;
      this.lastFrameAt = timestamp;
      this.lastSeenAt = timestamp;
    }
    this.shoulderWidthPx = shoulderWidthPx ?? this.shoulderWidthPx;
    if (trunkSw) this.maxTrunkSw = Math.max(this.maxTrunkSw, Math.hypot(trunkSw.x, trunkSw.y));

    if (wristSw) {
      this.activeMs += timestamp - this.lastFrameAt;
      this.lastSeenAt = timestamp;
    }
    this.lastFrameAt = timestamp;

    const newlyLit = wristSw ? this.measure(wristSw) : [];
    if (!wristSw) this.previous = DIRECTIONS_DEG.map(() => null);
    if (this.litCount === this.lit.length) this.allLitAtActiveMs ??= this.activeMs;

    const endsAtActiveMs =
      this.allLitAtActiveMs === null
        ? SWEEP_MS
        : Math.min(SWEEP_MS, this.allLitAtActiveMs + AFTER_LAST_STAR_MS);
    return {
      newlyLit,
      isFinished: this.activeMs >= endsAtActiveMs || timestamp - this.startedAt >= MAX_REAL_TIME_MS,
      isArmLost: timestamp - this.lastSeenAt > LOST_AFTER_MS,
      secondsLeft: Math.max(0, Math.ceil((endsAtActiveMs - this.activeMs) / 1000)),
    };
  }

  /** A direction nobody reached towards has no measurement, and is marked for the map. */
  results(): DirectionResult[] {
    return this.best.map((best) => ({
      bestProjectionSw: best,
      maxTrunkSw: this.maxTrunkSw,
      retries: 0,
      flagged: best === null,
      shoulderWidthPx: this.shoulderWidthPx,
    }));
  }

  private measure(wrist: Point): number[] {
    const newlyLit: number[] = [];
    const wristDeg = (Math.atan2(wrist.y, wrist.x) * 180) / Math.PI;
    const current = DIRECTIONS_DEG.map((deg) =>
      angleDifference(wristDeg, deg) <= SECTOR_HALF_WIDTH_DEG
        ? projectOnDirection(wrist, deg)
        : null,
    );

    current.forEach((projection, index) => {
      const before = this.previous[index];
      if (projection === null || before === null) return;
      const lasting = Math.min(projection, before);
      this.best[index] = Math.max(this.best[index] ?? -Infinity, lasting);
      if (!this.lit[index] && lasting >= STAR_LIGHTS_AT_SW) {
        this.lit[index] = true;
        newlyLit.push(index);
      }
    });
    this.previous = current;
    return newlyLit;
  }
}
