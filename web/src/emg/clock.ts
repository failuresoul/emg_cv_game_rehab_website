/**
 * Sample times from the firmware's counter, not from when the samples arrive.
 *
 * USB delivers samples in bursts, so arrival times are uneven even though the ESP32 sampled them
 * exactly 1/fs apart. Each sample's time is t = t0 + counter / fs. The offset t0 is the smallest
 * (arrival - counter / fs) seen: the least delayed sample is the best estimate of when sampling
 * really happened. t0 is re-estimated from each second's minimum, which follows slow drift
 * between the two clocks, and is held fixed within the second, so samples stay evenly spaced.
 */

export interface ClockStats {
  /** Samples received (duplicates not counted). */
  received: number;
  /** Samples missing between received ones (counter jumps). */
  missing: number;
  /** Missing as a share of all expected, 0-100. */
  gapsPct: number;
  /** Times the counter went back (the stream was started again). */
  restarts: number;
  /** Samples per second measured over the last second of arrivals; null until known. */
  measuredHz: number | null;
}

export class SampleClock {
  readonly fs: number;
  private readonly windowMs: number;
  private periodMs: number;
  private t0: number | null = null;
  private windowMin = Infinity;
  private windowStart: number | null = null;
  private windowStartCounter = 0;
  private lastCounter: number | null = null;
  private received = 0;
  private missing = 0;
  private restarts = 0;
  private measuredHz: number | null = null;

  constructor(fs: number, windowMs = 1000) {
    this.fs = fs;
    this.periodMs = 1000 / fs;
    this.windowMs = windowMs;
  }

  /**
   * The time (ms, in the clock of `arrivalMs`) at which this sample was taken; null for a
   * duplicate counter, which should be ignored.
   */
  push(counter: number, arrivalMs: number): number | null {
    if (this.lastCounter !== null) {
      if (counter === this.lastCounter) return null;
      if (counter < this.lastCounter) {
        // Started again (START): a new time base.
        this.restarts += 1;
        this.t0 = null;
        this.windowStart = null;
        this.windowMin = Infinity;
      } else if (counter > this.lastCounter + 1) {
        this.missing += counter - this.lastCounter - 1;
      }
    }
    this.lastCounter = counter;
    this.received += 1;

    const candidate = arrivalMs - counter * this.periodMs;
    this.windowMin = Math.min(this.windowMin, candidate);
    if (this.t0 === null) this.t0 = candidate;
    if (this.windowStart === null) {
      this.windowStart = arrivalMs;
      this.windowStartCounter = counter;
    } else if (arrivalMs - this.windowStart >= this.windowMs) {
      // Once per second: the least delayed sample of the second sets t0, and the rate is measured.
      this.t0 = this.windowMin;
      this.measuredHz =
        ((counter - this.windowStartCounter) * 1000) / (arrivalMs - this.windowStart);
      this.windowStart = arrivalMs;
      this.windowStartCounter = counter;
      this.windowMin = candidate;
    }
    return this.t0 + counter * this.periodMs;
  }

  stats(): ClockStats {
    const expected = this.received + this.missing;
    return {
      received: this.received,
      missing: this.missing,
      gapsPct: expected > 0 ? (this.missing / expected) * 100 : 0,
      restarts: this.restarts,
      measuredHz: this.measuredHz,
    };
  }
}
