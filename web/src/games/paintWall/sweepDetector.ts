/** The brush is "at the bottom" (arm straight) at or below this height. */
export const BOTTOM_HEIGHT = 0.15;
/** A sweep begins once the brush rises above this height, so jitter near the bottom is ignored. */
export const SWEEP_START_HEIGHT = 0.25;

export type SweepKind = "full" | "partial";

export interface Sweep {
  kind: SweepKind;
  /** The highest the brush went, from 0 to 1. */
  peakHeight: number;
  startMs: number;
  /** When the brush was back at the bottom. */
  endMs: number;
  durationMs: number;
}

/**
 * Counts sweeps: up from the bottom (arm straight) and back down again. A sweep that reached the
 * target height is full; one that rose past the start height but not to the target is partial.
 * Movement that never rises past the start height is jitter, not a sweep, and a sweep only ends
 * back at the bottom, so wobbling near the top does not split it in two. Pure: give it each
 * frame's height and time.
 */
export class SweepDetector {
  private readonly targetHeight: number;
  /** When the brush last left the bottom, and the peak since; null while at the bottom. */
  private leftBottomAt: number | null = null;
  private inSweep = false;
  private peak = 0;

  constructor(targetHeight: number) {
    this.targetHeight = Math.min(1, Math.max(SWEEP_START_HEIGHT, targetHeight));
  }

  get target(): number {
    return this.targetHeight;
  }

  /** True between the brush passing the start height and its return to the bottom. */
  get sweeping(): boolean {
    return this.inSweep;
  }

  /** The highest point of the sweep in progress, or 0. */
  get currentPeak(): number {
    return this.inSweep ? this.peak : 0;
  }

  /** One frame's brush height, or null when the arm is not seen (ignored). */
  update(height: number | null, nowMs: number): Sweep | null {
    if (height === null || !Number.isFinite(height)) return null;
    if (height <= BOTTOM_HEIGHT) {
      const finished = this.inSweep ? this.finish(nowMs) : null;
      this.leftBottomAt = null;
      this.inSweep = false;
      this.peak = 0;
      return finished;
    }
    this.leftBottomAt ??= nowMs;
    this.peak = Math.max(this.peak, height);
    if (!this.inSweep && height > SWEEP_START_HEIGHT) this.inSweep = true;
    return null;
  }

  private finish(nowMs: number): Sweep {
    const startMs = this.leftBottomAt ?? nowMs;
    return {
      kind: this.peak >= this.targetHeight ? "full" : "partial",
      peakHeight: this.peak,
      startMs,
      endMs: nowMs,
      durationMs: nowMs - startMs,
    };
  }
}
