import type { Point } from "./geometry";

// Smooths the on-screen cursor only. Saved data must always use raw positions.

export interface OneEuroOptions {
  minCutoffHz: number;
  beta: number;
  derivativeCutoffHz: number;
}

const DEFAULT_OPTIONS: OneEuroOptions = {
  minCutoffHz: 1.0,
  beta: 0.01,
  derivativeCutoffHz: 1.0,
};

function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const timeConstant = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + timeConstant / dtSeconds);
}

class OneEuroFilter1D {
  private previousValue: number | null = null;
  private previousDerivative = 0;
  private readonly options: OneEuroOptions;

  constructor(options: OneEuroOptions) {
    this.options = options;
  }

  filter(value: number, dtSeconds: number | null): number {
    if (this.previousValue === null || dtSeconds === null) {
      this.previousValue = value;
      this.previousDerivative = 0;
      return value;
    }

    const { minCutoffHz, beta, derivativeCutoffHz } = this.options;
    const derivative = (value - this.previousValue) / dtSeconds;
    const derivativeFactor = smoothingFactor(derivativeCutoffHz, dtSeconds);
    this.previousDerivative += derivativeFactor * (derivative - this.previousDerivative);

    const cutoff = minCutoffHz + beta * Math.abs(this.previousDerivative);
    this.previousValue += smoothingFactor(cutoff, dtSeconds) * (value - this.previousValue);
    return this.previousValue;
  }

  reset(): void {
    this.previousValue = null;
    this.previousDerivative = 0;
  }
}

export class OneEuroFilter2D {
  private readonly x: OneEuroFilter1D;
  private readonly y: OneEuroFilter1D;
  private lastTimestampMs: number | null = null;
  private lastOutput: Point | null = null;

  constructor(options: Partial<OneEuroOptions> = {}) {
    const merged = { ...DEFAULT_OPTIONS, ...options };
    this.x = new OneEuroFilter1D(merged);
    this.y = new OneEuroFilter1D(merged);
  }

  filter(point: Point, timestampMs: number): Point {
    const dtSeconds =
      this.lastTimestampMs === null ? null : (timestampMs - this.lastTimestampMs) / 1000;
    if (dtSeconds !== null && dtSeconds <= 0 && this.lastOutput) return this.lastOutput;

    this.lastTimestampMs = timestampMs;
    this.lastOutput = {
      x: this.x.filter(point.x, dtSeconds),
      y: this.y.filter(point.y, dtSeconds),
    };
    return this.lastOutput;
  }

  /** Call after a gap, so the cursor jumps to the new position instead of gliding across. */
  reset(): void {
    this.x.reset();
    this.y.reset();
    this.lastTimestampMs = null;
    this.lastOutput = null;
  }
}
