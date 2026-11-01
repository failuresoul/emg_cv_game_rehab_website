import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

import type { Side } from "@/types/api";

import {
  type BodyFrame,
  createBodyFrame,
  median,
  type Point,
  shoulderWidthPx,
  toBodyFrame,
  toPixel,
} from "./geometry";
import { HAND, isLandmarkVisible, POSE } from "./landmarks";
import { OneEuroFilter2D } from "./oneEuro";

const HAND_LOST_AFTER_MS = 500;
const SHOULDER_WIDTH_FRAMES = 30;

export interface TrackingState {
  timestamp: number;
  /** False once the hand has been missing for 500 ms. */
  handPresent: boolean;
  /** Time since the hand was last seen, or since tracking began if it has not been seen. */
  handLostMs: number;
  /** This frame's detection, or null if there is none. Use this for saved data. */
  fingertipRawSw: Point | null;
  /** On-screen cursor only. Holds its last position through gaps of under 500 ms. */
  fingertipSmoothSw: Point | null;
  /** The affected wrist from the body tracker, needing no hand detection. Raw, for saved data. */
  wristRawSw: Point | null;
  shoulderWidthPx: number | null;
  /** The last valid frame. Check poseOk to see whether it comes from the current frame. */
  frame: BodyFrame | null;
  /** How far the middle of the shoulders has moved since the start of the task. */
  trunkMidpointSw: Point | null;
  poseOk: boolean;
}

/** Keeps the unit steady: the median of recent widths ignores single bad frames. */
export class StableShoulderWidth {
  private readonly widths: number[] = [];

  add(widthPx: number): number {
    this.widths.push(widthPx);
    if (this.widths.length > SHOULDER_WIDTH_FRAMES) this.widths.shift();
    return this.value() as number;
  }

  value(): number | null {
    return this.widths.length > 0 ? median(this.widths) : null;
  }
}

export interface TrackerInput {
  timestamp: number;
  hand: readonly NormalizedLandmark[] | null;
  pose: readonly NormalizedLandmark[] | null;
  frameWidth: number;
  frameHeight: number;
}

export class Tracker {
  private readonly affectedSide: Side;
  private readonly shoulderWidth = new StableShoulderWidth();
  private readonly cursorFilter = new OneEuroFilter2D();
  private frame: BodyFrame | null = null;
  private taskStartMidpointPx: Point | null = null;
  private lastSeenAt: number | null = null;
  private firstTimestamp: number | null = null;
  private lastSmooth: Point | null = null;

  constructor(affectedSide: Side) {
    this.affectedSide = affectedSide;
  }

  /** The next frame with a valid pose becomes the zero point for trunkMidpointSw. */
  markTaskStart(): void {
    this.taskStartMidpointPx = null;
  }

  process(input: TrackerInput): TrackingState {
    const { timestamp, hand, pose, frameWidth, frameHeight } = input;
    this.firstTimestamp ??= timestamp;

    const widthPx = pose ? shoulderWidthPx(pose, frameWidth, frameHeight) : null;
    const poseOk = widthPx !== null && widthPx > 0;
    let trunkMidpointSw: Point | null = null;

    if (poseOk && pose) {
      const left = toPixel(pose[POSE.LEFT_SHOULDER], frameWidth, frameHeight);
      const right = toPixel(pose[POSE.RIGHT_SHOULDER], frameWidth, frameHeight);
      const stableWidth = this.shoulderWidth.add(widthPx);
      this.frame = createBodyFrame(left, right, this.affectedSide, stableWidth);

      const midpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      this.taskStartMidpointPx ??= midpoint;
      const current = toBodyFrame(midpoint, this.frame);
      const start = toBodyFrame(this.taskStartMidpointPx, this.frame);
      trunkMidpointSw = { x: current.x - start.x, y: current.y - start.y };
    }

    // Reaching across can hide the other shoulder, which only sets the unit and outward direction.
    const isLeft = this.affectedSide === "left";
    const affectedShoulder = pose?.[isLeft ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER];
    if (!poseOk && this.frame && affectedShoulder && isLandmarkVisible(affectedShoulder)) {
      this.frame = {
        ...this.frame,
        origin: toPixel(affectedShoulder, frameWidth, frameHeight),
      };
    }
    const wrist = pose?.[isLeft ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
    const shoulderIsCurrent = poseOk || isLandmarkVisible(affectedShoulder);
    const wristRawSw =
      this.frame && shoulderIsCurrent && isLandmarkVisible(wrist) && wrist
        ? toBodyFrame(toPixel(wrist, frameWidth, frameHeight), this.frame)
        : null;

    const fingertip = hand?.[HAND.INDEX_TIP];
    if (fingertip) this.lastSeenAt = timestamp;
    const handLostMs = timestamp - (this.lastSeenAt ?? this.firstTimestamp);
    const handPresent = this.lastSeenAt !== null && handLostMs < HAND_LOST_AFTER_MS;

    const fingertipRawSw =
      fingertip && this.frame
        ? toBodyFrame(toPixel(fingertip, frameWidth, frameHeight), this.frame)
        : null;

    if (fingertipRawSw) {
      this.lastSmooth = this.cursorFilter.filter(fingertipRawSw, timestamp);
    } else if (!handPresent) {
      this.cursorFilter.reset();
      this.lastSmooth = null;
    }

    return {
      timestamp,
      handPresent,
      handLostMs,
      fingertipRawSw,
      fingertipSmoothSw: this.lastSmooth,
      wristRawSw,
      shoulderWidthPx: this.shoulderWidth.value(),
      frame: this.frame,
      trunkMidpointSw,
      poseOk,
    };
  }
}
