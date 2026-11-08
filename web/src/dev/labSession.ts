import type { Side } from "@/types/api";
import type { FilteredAngles, FilteredHand } from "@/vision/angleFilter";
import type { JointAngles } from "@/vision/angles";
import type { HandMeasures } from "@/vision/hand";
import { type JointAngleState, type MeasureInput, MotionMeasurer } from "@/vision/measures";
import {
  CompensationMonitor,
  type CompensationReading,
  type ExerciseRep,
} from "@/warmup/compensation";
import type { CompensationConfig, CompensationType } from "@/warmup/compensationConfig";
import {
  type CounterEvent,
  type CounterState,
  createCounter,
  type ExerciseCounter,
  frameHasMeasure,
} from "@/warmup/counter";
import {
  EXERCISES,
  type ExerciseId,
  type ExercisePreset,
  type Thresholds,
} from "@/warmup/exercises";
import { frameForExercise } from "@/warmup/frames";

const MAX_EVENTS = 20;
const CHART_WINDOW_MS = 10_000;
const CHART_UPDATE_MS = 200;
const TRACKING_LOST_AFTER_MS = 500;

const MEASURES = [
  "armElevationDeg",
  "elevationPlaneDeg",
  "elbowFlexionDeg",
  "forwardReachRatio",
] as const;
const FINGERS = ["index", "middle", "ring", "little"] as const;

export interface LabEvent {
  id: number;
  timestamp: number;
  text: string;
}

export interface ChartPoint {
  /** Seconds before now, so the newest point is 0. */
  secondsAgo: number;
  value: number | null;
}

export interface LabConfig {
  exerciseId: ExerciseId;
  preset: ExercisePreset;
  side: Side;
}

export interface LabFrame extends Omit<MeasureInput, "hands"> {
  fps: number;
  /** Missing when testing the arm only. */
  hands?: MeasureInput["hands"];
}

export interface LabSnapshot {
  timestamp: number;
  fps: number;
  raw: JointAngles;
  filtered: FilteredAngles;
  hand: { raw: HandMeasures | null; filtered: FilteredHand };
  counterState: CounterState;
  /** For a sequence, the step expected next, from 0; otherwise null. */
  sequenceStep: number | null;
  fullReps: number;
  partialReps: number;
  manualCount: number;
  trackingPaused: boolean;
  thresholds: Thresholds;
  compensation: CompensationReading;
  compensationThresholds: CompensationConfig["thresholds"];
  /** The kinds this exercise checks; the others are shown but never flagged. */
  compensationChecks: readonly CompensationType[];
  events: readonly LabEvent[];
  /** Replaced only a few times a second, so a chart can skip the frames in between. */
  chart: readonly ChartPoint[];
  isRecording: boolean;
  recordedRows: number;
}

const CSV_COLUMNS = [
  "timestamp_ms",
  "exercise",
  "preset",
  "side",
  "low",
  "high",
  ...MEASURES.flatMap((measure) => [
    `${measure}_raw`,
    `${measure}_filtered`,
    `${measure}_source`,
    `${measure}_trunk_reference`,
    `${measure}_confidence`,
  ]),
  "hand_aperture_raw",
  "hand_aperture_filtered",
  ...FINGERS.flatMap((finger) => [`thumb_${finger}_raw`, `thumb_${finger}_filtered`]),
  "hand_source",
  "sequence_step",
  "trunk_displacement_sw",
  "trunk_lean_deg",
  "shoulder_hike_sw",
  "compensating",
  "fps",
  "counter_state",
  "full_reps",
  "partial_reps",
  "manual_count",
  "manual_presses",
];

type CsvCell = string | number | null | undefined;

function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The lab's logic, apart from the screen. A counter's thresholds are fixed once made, so changing
 * them starts a new counter and carries the totals over.
 */
export class LabSession {
  private config: LabConfig;
  private thresholds: Thresholds;
  private counter!: ExerciseCounter;
  private measurer: MotionMeasurer;
  private monitor: CompensationMonitor;
  private carriedFull = 0;
  private carriedPartial = 0;
  private manualCount = 0;
  private pendingPresses = 0;
  private events: LabEvent[] = [];
  private nextEventId = 1;
  private lastTimestamp = 0;
  private lastSeenAt: number | null = null;
  private trackingPaused = false;
  private chartHistory: { timestamp: number; value: number | null }[] = [];
  private chart: readonly ChartPoint[] = [];
  private lastChartAt = -Infinity;
  private recording = false;
  private rows: CsvCell[][] = [];

  constructor(config: LabConfig) {
    this.config = config;
    this.thresholds = EXERCISES[config.exerciseId].presets[config.preset];
    this.measurer = new MotionMeasurer(config.side);
    this.monitor = new CompensationMonitor(config.exerciseId);
    this.makeCounter();
  }

  get currentConfig(): LabConfig {
    return this.config;
  }

  get currentThresholds(): Thresholds {
    return this.thresholds;
  }

  get hasRecording(): boolean {
    return this.rows.length > 0;
  }

  /** A new exercise, preset or side starts again, as its counts would not be comparable. */
  configure(config: LabConfig): void {
    this.config = config;
    this.thresholds = EXERCISES[config.exerciseId].presets[config.preset];
    this.measurer = new MotionMeasurer(config.side);
    this.monitor = new CompensationMonitor(config.exerciseId);
    this.reset();
    this.log(`configured ${config.exerciseId}, ${config.preset}, ${config.side} affected`);
  }

  /** Keeps the totals. Any movement in progress is dropped, and the arm must return to rest. */
  setThresholds(thresholds: Thresholds): void {
    this.carriedFull += this.counter.fullReps;
    this.carriedPartial += this.counter.partialReps;
    this.thresholds = thresholds;
    this.makeCounter();
    this.log(`thresholds low ${thresholds.low}, high ${thresholds.high}`);
  }

  /** Measures a new posture baseline over the next 2 seconds. Sit still while it does. */
  rebaseline(): void {
    this.monitor.rebaseline();
    this.log("re-baselining posture, sit still for 2 seconds");
  }

  pressManualCount(): void {
    this.manualCount += 1;
    this.pendingPresses += 1;
    this.log(`manual count ${this.manualCount}`);
  }

  /** Clears counts and the log. A recording is kept until the next one starts. */
  reset(): void {
    this.carriedFull = 0;
    this.carriedPartial = 0;
    this.manualCount = 0;
    this.pendingPresses = 0;
    this.events = [];
    this.chartHistory = [];
    this.chart = [];
    this.lastSeenAt = null;
    this.trackingPaused = false;
    this.monitor.rebaseline();
    this.makeCounter();
  }

  startRecording(): void {
    this.rows = [];
    this.recording = true;
    this.log("recording started");
  }

  stopRecording(): void {
    this.recording = false;
    this.log(`recording stopped, ${this.rows.length} rows`);
  }

  toCsv(): string {
    return [CSV_COLUMNS, ...this.rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }

  process(frame: LabFrame): LabSnapshot {
    const { timestamp } = frame;
    this.lastTimestamp = timestamp;
    this.lastSeenAt ??= timestamp;

    const state = this.measurer.process({ ...frame, hands: frame.hands ?? [] });
    const { raw, filtered } = state;
    const exerciseFrame = frameForExercise(EXERCISES[this.config.exerciseId], state);
    // For a sequence, the chart shows the distance to the finger expected next.
    const value =
      exerciseFrame.values !== undefined
        ? (exerciseFrame.values?.[this.counter.sequenceStep ?? 0] ?? null)
        : exerciseFrame.value;

    if (!frameHasMeasure(exerciseFrame)) {
      // Matches the warm-up, except that the lab resumes at once so that nothing is hidden.
      if (!this.trackingPaused && timestamp - this.lastSeenAt > TRACKING_LOST_AFTER_MS) {
        this.trackingPaused = true;
        this.counter.pause();
        this.log("tracking lost, paused");
      }
    } else {
      if (this.trackingPaused) {
        this.trackingPaused = false;
        this.counter.resume();
        this.log("tracking back, resumed");
      }
      this.lastSeenAt = timestamp;
    }
    // Before the counter, so this frame's posture belongs to any rep it ends.
    const hadBaseline = this.monitor.baseline !== null;
    const reading = this.monitor.addSample(this.trackingPaused ? null : state.posture, timestamp);
    if (!hadBaseline && reading.baseline) this.log("posture baseline ready");
    if (reading.cue) this.log(`cue ${reading.cue}`);
    if (!this.trackingPaused && frameHasMeasure(exerciseFrame)) this.counter.feed(exerciseFrame);

    this.addToChart(timestamp, value);
    if (this.recording) this.recordRow(frame, state);

    return {
      timestamp,
      fps: frame.fps,
      raw,
      filtered,
      hand: state.hand,
      counterState: this.counter.state,
      sequenceStep: this.counter.sequenceStep,
      fullReps: this.fullReps,
      partialReps: this.partialReps,
      manualCount: this.manualCount,
      trackingPaused: this.trackingPaused,
      thresholds: this.thresholds,
      compensation: reading,
      compensationThresholds: this.monitor.thresholds,
      compensationChecks: this.monitor.checkedTypes,
      events: this.events,
      chart: this.chart,
      isRecording: this.recording,
      recordedRows: this.rows.length,
    };
  }

  private get fullReps(): number {
    return this.carriedFull + this.counter.fullReps;
  }

  private get partialReps(): number {
    return this.carriedPartial + this.counter.partialReps;
  }

  private makeCounter(): void {
    this.counter = createCounter(EXERCISES[this.config.exerciseId], this.thresholds);
    this.counter.subscribe((event) => {
      const rep = this.monitor.handleCounterEvent(event);
      this.log(describeEvent(event));
      if (rep?.compensated) this.log(describeCompensation(rep));
    });
  }

  private addToChart(timestamp: number, value: number | null): void {
    this.chartHistory.push({ timestamp, value });
    const oldest = timestamp - CHART_WINDOW_MS;
    while (this.chartHistory[0].timestamp < oldest) this.chartHistory.shift();

    if (timestamp - this.lastChartAt < CHART_UPDATE_MS) return;
    this.lastChartAt = timestamp;
    this.chart = this.chartHistory.map((point) => ({
      secondsAgo: (point.timestamp - timestamp) / 1000,
      value: point.value,
    }));
  }

  private recordRow(frame: LabFrame, state: JointAngleState): void {
    const { raw, filtered, hand } = state;
    const { exerciseId, preset, side } = this.config;
    this.rows.push([
      frame.timestamp,
      exerciseId,
      preset,
      side,
      this.thresholds.low,
      this.thresholds.high,
      ...MEASURES.flatMap((measure) => [
        raw[measure]?.value,
        filtered[measure],
        raw[measure]?.source,
        raw[measure]?.trunkReference,
        raw[measure]?.confidence,
      ]),
      hand.raw?.handApertureRatio,
      hand.filtered.handApertureRatio,
      ...FINGERS.flatMap((_, index) => [
        hand.raw?.thumbFingerDistances[index],
        hand.filtered.thumbFingerDistances?.[index],
      ]),
      hand.raw?.source,
      this.counter.sequenceStep,
      this.monitor.reading.values?.trunkDisplacement,
      this.monitor.reading.values?.trunkLeanDeg,
      this.monitor.reading.values?.shoulderHike,
      this.monitor.reading.sustained.join("+"),
      frame.fps,
      this.counter.state,
      this.fullReps,
      this.partialReps,
      this.manualCount,
      this.pendingPresses,
    ]);
    this.pendingPresses = 0;
  }

  private log(text: string): void {
    const event = { id: this.nextEventId++, timestamp: this.lastTimestamp, text };
    this.events = [event, ...this.events].slice(0, MAX_EVENTS);
  }
}

function describeEvent(event: CounterEvent): string {
  switch (event.type) {
    case "stateChanged":
      return `state ${event.state}`;
    case "feedback":
      return `feedback ${event.feedback}`;
    case "repCompleted":
      return `full rep, peak ${event.rep.peakValue.toFixed(1)}, ${Math.round(event.rep.durationMs)} ms`;
    case "partialRep":
      return `partial rep, peak ${event.rep.peakValue.toFixed(1)}, ${Math.round(event.rep.durationMs)} ms`;
  }
}

function describeCompensation(rep: ExerciseRep): string {
  const max = rep.compensationMax;
  const detail = max
    ? `max trunk ${max.trunkDisplacement.toFixed(2)} SW, lean ${max.trunkLeanDeg.toFixed(0)} deg, hike ${max.shoulderHike.toFixed(2)} SW`
    : "no posture values";
  return `compensated (${rep.compensationTypes.join(", ")}): ${detail}`;
}
