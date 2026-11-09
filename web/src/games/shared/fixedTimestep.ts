export const UPDATE_HZ = 60;
export const STEP_MS = 1000 / UPDATE_HZ;
/** After a long stall, such as a hidden tab, catch up at most this much instead of racing. */
export const MAX_FRAME_MS = 250;

/**
 * Runs game updates at a fixed rate whatever the screen's refresh rate: each animation frame adds
 * its duration to an accumulator, and each whole step in it becomes one update. Game time only
 * moves while frames are fed, so a paused game simply stops feeding it.
 */
export class FixedTimestep {
  readonly stepMs: number;
  private readonly maxFrameMs: number;
  private accumulator = 0;
  private time: number;

  constructor(startMs = 0, stepMs = STEP_MS, maxFrameMs = MAX_FRAME_MS) {
    if (!(stepMs > 0)) throw new RangeError(`stepMs (${stepMs}) must be above 0`);
    this.stepMs = stepMs;
    this.maxFrameMs = maxFrameMs;
    this.time = startMs;
  }

  /** Game time after the last update. */
  get now(): number {
    return this.time;
  }

  /** How far into the next step the leftover time is, from 0 to 1, for smooth drawing. */
  get alpha(): number {
    return this.accumulator / this.stepMs;
  }

  /** Runs as many fixed updates as this frame's time allows. Returns how many ran. */
  advance(frameMs: number, update: (dtMs: number, nowMs: number) => void): number {
    if (!(frameMs > 0)) return 0;
    this.accumulator += Math.min(frameMs, this.maxFrameMs);
    let steps = 0;
    // A small tolerance stops floating-point error from dropping a step now and then.
    while (this.accumulator >= this.stepMs - 1e-9) {
      this.accumulator -= this.stepMs;
      this.time += this.stepMs;
      update(this.stepMs, this.time);
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    return steps;
  }

  /** Forgets leftover time, for example after a pause, so nothing is made up for it. */
  resetAccumulator(): void {
    this.accumulator = 0;
  }
}
