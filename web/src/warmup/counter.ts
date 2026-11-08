import type { ExerciseDefinition, Thresholds } from "./exercises";
import { RepCounter, type RepEvent, type RepRecord, type RepState } from "./repCounter";
import { SequenceCounter, type SequenceEvent, type SequenceState } from "./sequenceCounter";

/** One frame for a counter. Single-value exercises use `value`; sequences use `values`. */
export interface CounterFrame {
  timestamp: number;
  /** The filtered value that gets counted. */
  value: number | null;
  /** The unfiltered value, kept in the rep's record only. */
  rawValue?: number | null;
  /** For a sequence: one filtered value per step, such as the thumb's distance to each finger. */
  values?: readonly number[] | null;
  rawValues?: readonly number[] | null;
}

export type CounterState = RepState | SequenceState;
export type CounterEvent = RepEvent | SequenceEvent;

/** What ExerciseRunner needs from a counter, so it can run any kind of exercise. */
export interface ExerciseCounter {
  readonly state: CounterState;
  /** True while a movement cannot begin, because the start position has not been seen. */
  readonly awaitingRest: boolean;
  readonly fullReps: number;
  readonly partialReps: number;
  readonly reps: readonly RepRecord[];
  /** For a sequence, the step expected next, from 0. Null for single-value counters. */
  readonly sequenceStep: number | null;
  feed(frame: CounterFrame): void;
  /** Abandons any movement in progress, so a pause never creates or completes a rep. */
  pause(): void;
  resume(): void;
  subscribe(listener: (event: CounterEvent) => void): () => void;
}

/** True if the frame carries the measure its counter needs. */
export function frameHasMeasure(frame: CounterFrame): boolean {
  if (frame.values !== undefined) {
    return frame.values !== null && frame.values.length > 0 && frame.values.every(Number.isFinite);
  }
  return frame.value !== null && Number.isFinite(frame.value);
}

/** The counter an exercise needs, with the thresholds to use. */
export function createCounter(
  definition: ExerciseDefinition,
  thresholds: Thresholds,
): ExerciseCounter {
  if (definition.counter === "sequence") return new SequenceCounter(thresholds);
  return new RepCounter({
    direction: definition.direction,
    hysteresis: definition.hysteresis,
    ...thresholds,
  });
}
