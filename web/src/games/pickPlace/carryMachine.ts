import type { TrialOutcome } from "@/types/api";
import type { Point } from "@/vision/geometry";

import { insideBox } from "./placement";

/** How long the box takes to close after a success, or the miss message shows, in ms. */
export const OUTCOME_MS = 1200;
/**
 * A pinch grasps the object within this share of its radius from its centre: a little more than
 * the drawn object, so a pinch on its edge still counts.
 */
export const GRASP_REACH = 1.15;

export type CarryPhase = "REACH" | "CARRY" | "OUTCOME" | "REST" | "DONE";

export interface CarrySettings {
  /** The object's starting centre and the box's centre, in SW. */
  pick: Point;
  place: Point;
  objectRadiusSw: number;
  boxSizeSw: number;
  timeLimitMs: number;
  restMs: number;
}

export interface CarryInput {
  nowMs: number;
  /** The pinch point the patient sees (smoothed), in SW; null while the hand is not seen. */
  point: Point | null;
  /** Whether thumb and index are pinched; null while that cannot be measured. */
  pinching: boolean | null;
}

/** Game times of each moment, or null if it never happened. */
export interface CarryMoments {
  spawn: number;
  /** The pinch point first reached the object. */
  reached: number | null;
  /** The first grasp, and the latest one (they differ after a drop). */
  firstGrasp: number | null;
  lastGrasp: number | null;
  /** The release inside the box. */
  placed: number | null;
  end: number | null;
}

export type CarryEvent =
  | { type: "reached" }
  | { type: "grasped" }
  /** Pinching already when the object was reached: the fingers must open first. */
  | { type: "openFirst" }
  | { type: "dropped"; at: Point | null }
  | { type: "placed"; at: Point }
  | { type: "timeout" }
  | { type: "phase"; phase: CarryPhase };

/**
 * One pick-and-place trial, from the object appearing to the rest after it. Pure: give it each
 * frame's pinch point and pinch state. Only a pinch that starts on the object grasps it; while it
 * is held the object follows the pinch point; opening the pinch inside the box places it, and
 * anywhere else drops it back where it started, to try again until the time limit. Frames where
 * the pinch cannot be measured change nothing, so a lost frame never drops the object.
 */
export class CarryMachine {
  readonly settings: CarrySettings;
  readonly moments: CarryMoments;
  private currentPhase: CarryPhase = "REACH";
  private phaseStart: number;
  private objectAt: Point;
  private wasPinching: boolean | null = null;
  private dropCount = 0;
  private toldToOpen = false;
  private result: TrialOutcome | null = null;
  private releasePoint: Point | null = null;

  constructor(settings: CarrySettings, spawnMs: number) {
    this.settings = settings;
    this.moments = {
      spawn: spawnMs,
      reached: null,
      firstGrasp: null,
      lastGrasp: null,
      placed: null,
      end: null,
    };
    this.phaseStart = spawnMs;
    this.objectAt = { ...settings.pick };
  }

  get phase(): CarryPhase {
    return this.currentPhase;
  }

  /** Reaching or carrying: the trial is under way. */
  get isLive(): boolean {
    return this.currentPhase === "REACH" || this.currentPhase === "CARRY";
  }

  get holding(): boolean {
    return this.currentPhase === "CARRY";
  }

  /** Where the object is drawn now, in SW. */
  get objectPosition(): Point {
    return this.objectAt;
  }

  get drops(): number {
    return this.dropCount;
  }

  get outcome(): TrialOutcome | null {
    return this.result;
  }

  /** Where the object was let go in the box, as the patient saw it. */
  get placedAt(): Point | null {
    return this.releasePoint;
  }

  /** From 0 to 1 over the outcome: how far the box's lid has closed. */
  outcomeProgress(nowMs: number): number {
    if (this.moments.end === null) return 0;
    return Math.min(1, Math.max(0, (nowMs - this.moments.end) / OUTCOME_MS));
  }

  update({ nowMs, point, pinching }: CarryInput): CarryEvent[] {
    const events: CarryEvent[] = [];
    if (this.isLive) this.play(nowMs, point, pinching, events);
    if (this.currentPhase === "OUTCOME" && nowMs - this.phaseStart >= OUTCOME_MS) {
      this.enter("REST", nowMs, events);
    }
    if (this.currentPhase === "REST" && nowMs - this.phaseStart >= this.settings.restMs) {
      this.enter("DONE", nowMs, events);
    }
    return events;
  }

  private play(
    nowMs: number,
    point: Point | null,
    pinching: boolean | null,
    events: CarryEvent[],
  ): void {
    const { settings, moments } = this;
    const near =
      point !== null &&
      Math.hypot(point.x - this.objectAt.x, point.y - this.objectAt.y) <=
        settings.objectRadiusSw * GRASP_REACH;

    if (this.currentPhase === "REACH") {
      if (near && moments.reached === null) {
        moments.reached = nowMs;
        events.push({ type: "reached" });
      }
      const pinchStarted = pinching === true && this.wasPinching === false;
      if (near && pinchStarted) {
        moments.firstGrasp ??= nowMs;
        moments.lastGrasp = nowMs;
        this.enter("CARRY", nowMs, events);
        events.push({ type: "grasped" });
      } else if (near && pinching === true && !this.toldToOpen) {
        this.toldToOpen = true;
        events.push({ type: "openFirst" });
      }
    } else if (this.currentPhase === "CARRY") {
      if (point) this.objectAt = { ...point };
      if (pinching === false) {
        if (insideBox(this.objectAt, settings.place, settings.boxSizeSw)) {
          moments.placed = nowMs;
          this.releasePoint = { ...this.objectAt };
          this.finish("success", nowMs, events);
          events.push({ type: "placed", at: { ...this.objectAt } });
        } else {
          this.dropCount++;
          events.push({ type: "dropped", at: point ? { ...point } : null });
          this.objectAt = { ...settings.pick };
          this.enter("REACH", nowMs, events);
        }
      }
    }
    if (pinching !== null) this.wasPinching = pinching;

    if (this.isLive && nowMs - moments.spawn >= settings.timeLimitMs) {
      this.objectAt = { ...settings.pick };
      this.finish("miss", nowMs, events);
      events.push({ type: "timeout" });
    }
  }

  private finish(outcome: TrialOutcome, nowMs: number, events: CarryEvent[]): void {
    this.result = outcome;
    this.moments.end = nowMs;
    this.enter("OUTCOME", nowMs, events);
  }

  private enter(phase: CarryPhase, nowMs: number, events: CarryEvent[]): void {
    this.currentPhase = phase;
    this.phaseStart = nowMs;
    events.push({ type: "phase", phase });
  }
}
