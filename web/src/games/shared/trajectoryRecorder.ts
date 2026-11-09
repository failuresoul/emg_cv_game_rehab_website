import type { TrajectoryPoint } from "@/types/api";
import type { Point } from "@/vision/geometry";

/** The server accepts at most this many points per trial. */
export const MAX_TRAJECTORY_POINTS = 2000;
export const TRAJECTORY_HZ = 30;
/**
 * Frames closer together than this are skipped. Below the 33 ms of 30 Hz, so a 30 fps camera with
 * some jitter keeps every frame and a faster one keeps about every other frame.
 */
const MIN_GAP_MS = (1000 / TRAJECTORY_HZ) * 0.75;

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * The raw fingertip during one trial, in the body frame, at about 30 Hz. Times are relative to the
 * trial's spawn. Recording stops at 2000 points (more than a minute), and `truncated` says so.
 */
export class TrajectoryRecorder {
  private readonly maxPoints: number;
  private spawnMs = 0;
  private lastMs: number | null = null;
  private points: TrajectoryPoint[] = [];
  private wasTruncated = false;

  constructor(maxPoints = MAX_TRAJECTORY_POINTS) {
    this.maxPoints = maxPoints;
  }

  /** Begins a new trial, forgetting the last one. */
  start(spawnMs: number): void {
    this.spawnMs = spawnMs;
    this.lastMs = null;
    this.points = [];
    this.wasTruncated = false;
  }

  /**
   * One frame. A missing fingertip is skipped rather than saved as a gap, and so is a frame from
   * before the spawn (a camera frame can be up to one frame older than the trial). Returns true if
   * kept.
   */
  add(timestampMs: number, pointSw: Point | null): boolean {
    if (!pointSw || !Number.isFinite(pointSw.x) || !Number.isFinite(pointSw.y)) return false;
    if (timestampMs < this.spawnMs) return false;
    if (this.lastMs !== null && timestampMs - this.lastMs < MIN_GAP_MS) return false;
    if (this.points.length >= this.maxPoints) {
      this.wasTruncated = true;
      return false;
    }
    this.lastMs = timestampMs;
    this.points.push([
      round(timestampMs - this.spawnMs, 1),
      round(pointSw.x, 4),
      round(pointSw.y, 4),
    ]);
    return true;
  }

  get length(): number {
    return this.points.length;
  }

  get truncated(): boolean {
    return this.wasTruncated;
  }

  /** A copy of the points so far. */
  toArray(): TrajectoryPoint[] {
    return this.points.map((point) => [...point] as TrajectoryPoint);
  }
}
