import { angleBetween, subtract, type Vec3 } from "@/vision/angles";
import { averageOf as average, type PostureSample } from "@/vision/posture";

import type { CounterEvent } from "./counter";
import {
  COMPENSATION_CONFIG,
  type CompensationConfig,
  type CompensationType,
} from "./compensationConfig";
import type { ExerciseId } from "./exercises";
import type { RepRecord } from "./repCounter";

const TYPES: readonly CompensationType[] = ["trunk", "lean", "shoulder"];

export interface CompensationValues {
  /** How far the shoulder midpoint has moved from the baseline, in shoulder widths. */
  trunkDisplacement: number;
  /** How far the trunk has tilted from the baseline, in degrees. */
  trunkLeanDeg: number;
  /** How far the affected shoulder has risen relative to the other, in shoulder widths. */
  shoulderHike: number;
}

export interface CompensationBaseline {
  shoulderMidpoint: Vec3;
  shoulderWidth: number;
  affectedShoulderRise: number;
  trunkVector: Vec3 | null;
  shoulderLine: Vec3;
}

export type CompensationCue = "back" | "shoulder";

export interface CompensationReading {
  baseline: CompensationBaseline | null;
  values: CompensationValues | null;
  /** Kinds over their threshold for at least the sustain time, among those this exercise checks. */
  sustained: CompensationType[];
  /** A cue to show now, at most once per cue interval. */
  cue: CompensationCue | null;
}

/** A rep with what was seen of the person's posture during it. */
export interface ExerciseRep extends RepRecord {
  compensated: boolean;
  compensationTypes: CompensationType[];
  /** The largest values during the rep, or null if posture was never measured during it. */
  compensationMax: CompensationValues | null;
}

/** How far a posture is from its baseline. */
export function compensationValues(
  sample: PostureSample,
  baseline: CompensationBaseline,
): CompensationValues {
  const moved = subtract(sample.shoulderMidpoint, baseline.shoulderMidpoint);
  const unit = 1 / baseline.shoulderWidth;
  // The trunk line is better, but the shoulder line still shows leaning to one side.
  const lean =
    sample.trunkVector && baseline.trunkVector
      ? angleBetween(sample.trunkVector, baseline.trunkVector)
      : angleBetween(sample.shoulderLine, baseline.shoulderLine);
  return {
    trunkDisplacement: Math.hypot(moved.x, moved.y, moved.z) * unit,
    trunkLeanDeg: Number.isFinite(lean) ? lean : 0,
    shoulderHike: Math.max(0, sample.affectedShoulderRise - baseline.affectedShoulderRise) * unit,
  };
}

/** The kinds whose values are over their threshold. */
export function exceededTypes(
  values: CompensationValues,
  config: CompensationConfig = COMPENSATION_CONFIG,
): CompensationType[] {
  const { thresholds } = config;
  const over: Record<CompensationType, boolean> = {
    trunk: values.trunkDisplacement > thresholds.trunkDisplacement,
    lean: values.trunkLeanDeg > thresholds.trunkLeanDeg,
    shoulder: values.shoulderHike > thresholds.shoulderHike,
  };
  return TYPES.filter((type) => over[type]);
}

export function cueFor(types: readonly CompensationType[]): CompensationCue | null {
  if (types.includes("trunk") || types.includes("lean")) return "back";
  return types.includes("shoulder") ? "shoulder" : null;
}

const maxValues = (a: CompensationValues | null, b: CompensationValues): CompensationValues =>
  a === null
    ? b
    : {
        trunkDisplacement: Math.max(a.trunkDisplacement, b.trunkDisplacement),
        trunkLeanDeg: Math.max(a.trunkLeanDeg, b.trunkLeanDeg),
        shoulderHike: Math.max(a.shoulderHike, b.shoulderHike),
      };

/**
 * Watches posture through one exercise: a baseline from the first 2 seconds, then which
 * thresholds stay exceeded, which reps they happen in, and when to cue. Feed it frames with
 * `addSample` and the counter's events with `handleCounterEvent`, in the same order as they occur.
 */
export class CompensationMonitor {
  private readonly config: CompensationConfig;
  private readonly checks: readonly CompensationType[];

  private baselineStart: number | null = null;
  private baselineSamples: PostureSample[] = [];
  private currentBaseline: CompensationBaseline | null = null;
  private readonly runStart = new Map<CompensationType, number>();
  private lastCueAt = -Infinity;
  private latest: CompensationReading = { baseline: null, values: null, sustained: [], cue: null };

  private inRep = false;
  private repTypes = new Set<CompensationType>();
  private repMax: CompensationValues | null = null;
  /** The posture of the rep that just ended, waiting for the counter to report the rep itself. */
  private finished: { types: CompensationType[]; max: CompensationValues | null } | null = null;

  constructor(exerciseId: ExerciseId, config: CompensationConfig = COMPENSATION_CONFIG) {
    this.config = config;
    this.checks = config.checks[exerciseId];
  }

  get baseline(): CompensationBaseline | null {
    return this.currentBaseline;
  }

  get reading(): CompensationReading {
    return this.latest;
  }

  get thresholds(): CompensationConfig["thresholds"] {
    return this.config.thresholds;
  }

  get checkedTypes(): readonly CompensationType[] {
    return this.checks;
  }

  /** Measures a new baseline from the next 2 seconds of frames. */
  rebaseline(): void {
    this.baselineStart = null;
    this.baselineSamples = [];
    this.currentBaseline = null;
    this.runStart.clear();
    this.latest = { baseline: null, values: null, sustained: [], cue: null };
  }

  /** A missing sample, such as lost tracking, breaks every run of exceeded frames. */
  addSample(sample: PostureSample | null, timestamp: number): CompensationReading {
    if (sample === null) {
      this.runStart.clear();
      this.latest = { ...this.latest, values: null, sustained: [], cue: null };
      return this.latest;
    }

    if (this.currentBaseline === null) {
      this.collectBaseline(sample, timestamp);
      this.latest = { baseline: this.currentBaseline, values: null, sustained: [], cue: null };
      return this.latest;
    }

    const values = compensationValues(sample, this.currentBaseline);
    const over = new Set(
      exceededTypes(values, this.config).filter((type) => this.checks.includes(type)),
    );
    for (const type of TYPES) {
      if (!over.has(type)) this.runStart.delete(type);
      else if (!this.runStart.has(type)) this.runStart.set(type, timestamp);
    }
    const sustained = TYPES.filter((type) => {
      const start = this.runStart.get(type);
      return start !== undefined && timestamp - start >= this.config.sustainMs;
    });

    if (this.inRep) {
      sustained.forEach((type) => this.repTypes.add(type));
      this.repMax = maxValues(this.repMax, values);
    }

    let cue: CompensationCue | null = null;
    const wanted = cueFor(sustained);
    if (wanted && timestamp - this.lastCueAt >= this.config.cueIntervalMs) {
      cue = wanted;
      this.lastCueAt = timestamp;
    }

    this.latest = { baseline: this.currentBaseline, values, sustained, cue };
    return this.latest;
  }

  /**
   * A rep runs from the counter leaving REST until it returns. Returns the rep with its posture
   * for a completed or partial rep, and null for every other event.
   */
  handleCounterEvent(event: CounterEvent): ExerciseRep | null {
    if (event.type === "stateChanged") {
      if (event.state === "REST") {
        if (this.inRep) this.finished = { types: [...this.repTypes], max: this.repMax };
        this.inRep = false;
      } else if (!this.inRep) {
        this.inRep = true;
        this.repTypes = new Set();
        this.repMax = null;
        this.finished = null;
      }
      return null;
    }
    if (event.type !== "repCompleted" && event.type !== "partialRep") return null;

    const posture = this.finished ?? { types: [...this.repTypes], max: this.repMax };
    this.finished = null;
    return {
      ...event.rep,
      compensated: posture.types.length > 0,
      compensationTypes: TYPES.filter((type) => posture.types.includes(type)),
      compensationMax: posture.max,
    };
  }

  private collectBaseline(sample: PostureSample, timestamp: number): void {
    // A change between world and image landmarks would mix units, so start again.
    if (this.baselineSamples.length > 0 && this.baselineSamples[0].source !== sample.source) {
      this.baselineSamples = [];
      this.baselineStart = null;
    }
    this.baselineStart ??= timestamp;
    this.baselineSamples.push(sample);
    if (timestamp - this.baselineStart < this.config.baselineMs) return;

    const samples = this.baselineSamples;
    const trunkVectors = samples.flatMap((item) => (item.trunkVector ? [item.trunkVector] : []));
    this.currentBaseline = {
      shoulderMidpoint: average(samples.map((item) => item.shoulderMidpoint)),
      shoulderWidth:
        samples.reduce((total, item) => total + item.shoulderWidth, 0) / samples.length,
      affectedShoulderRise:
        samples.reduce((total, item) => total + item.affectedShoulderRise, 0) / samples.length,
      // Only if the hips were seen for most of the baseline.
      trunkVector: trunkVectors.length > samples.length / 2 ? average(trunkVectors) : null,
      shoulderLine: average(samples.map((item) => item.shoulderLine)),
    };
    this.baselineSamples = [];
  }
}
