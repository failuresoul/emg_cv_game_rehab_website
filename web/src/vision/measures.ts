import type { Side } from "@/types/api";

import {
  type FilteredAngles,
  type FilteredHand,
  HandFilter,
  JointAngleFilter,
} from "./angleFilter";
import {
  ArmLengthTracker,
  computeJointAngles,
  type JointAngleInput,
  type JointAngles,
} from "./angles";
import { computeHandMeasures, type HandMeasures, selectAffectedHand } from "./hand";
import { computePosture, type PostureSample } from "./posture";
import type { DetectedHand } from "./visionEngine";

export interface MeasureInput extends JointAngleInput {
  timestamp: number;
  hands: readonly DetectedHand[];
}

export interface JointAngleState {
  timestamp: number;
  /** Each arm measure with its quality information. Use these for saved data. */
  raw: JointAngles;
  /** Steadied values, for counting repetitions only. */
  filtered: FilteredAngles;
  /** The trunk's posture, for spotting compensation. Null unless both shoulders are visible. */
  posture: PostureSample | null;
  hand: {
    /** Null when the affected hand is not visible. Use these for saved data. */
    raw: HandMeasures | null;
    filtered: FilteredHand;
  };
}

/** Every measure of the affected arm and hand, frame by frame, keeping the filters' history. */
export class MotionMeasurer {
  private readonly affectedSide: Side;
  private readonly armLengths = new ArmLengthTracker();
  private readonly angleFilter = new JointAngleFilter();
  private readonly handFilter = new HandFilter();

  constructor(affectedSide: Side) {
    this.affectedSide = affectedSide;
  }

  process(input: MeasureInput): JointAngleState {
    const raw = computeJointAngles(input, this.affectedSide, this.armLengths);
    const hand = selectAffectedHand(input, this.affectedSide);
    const handRaw = computeHandMeasures(hand, input.frameWidth, input.frameHeight);
    return {
      timestamp: input.timestamp,
      raw,
      filtered: this.angleFilter.add(raw),
      posture: computePosture(input, this.affectedSide),
      hand: { raw: handRaw, filtered: this.handFilter.add(handRaw) },
    };
  }
}
