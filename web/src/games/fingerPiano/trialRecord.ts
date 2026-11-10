import type { GameParams } from "@/games/shared/types";
import type { Finger } from "@/input/fingerTouch";
import type { TrialCompensation, TrialCreate } from "@/types/api";

import { type NoteState, SUCCESS_HIT_RATE } from "./melodyMachine";

export const POINTS_PER_HIT = 25;
export const MELODY_BONUS = 50;

export interface FingerTally {
  hits: number;
  /** Notes that asked for this finger. */
  attempts: number;
}

export interface MelodyMetrics {
  notesTotal: number;
  hits: number;
  /** Notes not played, with at least one wrong finger touched in their window. */
  wrongFinger: number;
  /** Notes with no touch at all in their window. */
  missed: number;
  /** hits over notesTotal, from 0 to 1. */
  hitRate: number;
  /** Mean of |touch − arrival| over the hits; null without hits. */
  meanTimingErrorMs: number | null;
  /** Only the fingers the melody used. */
  perFinger: Partial<Record<Finger, FingerTally>>;
}

/** The melody's measures, from its notes once every window has closed. */
export function melodyMetrics(notes: readonly NoteState[]): MelodyMetrics {
  const count = (status: NoteState["status"]) =>
    notes.filter((note) => note.status === status).length;
  const hits = count("hit");
  const errors = notes
    .filter((note) => note.status === "hit" && note.errorMs !== null)
    .map((note) => Math.abs(note.errorMs as number));
  const perFinger: Partial<Record<Finger, FingerTally>> = {};
  for (const note of notes) {
    const tally = (perFinger[note.finger] ??= { hits: 0, attempts: 0 });
    tally.attempts++;
    if (note.status === "hit") tally.hits++;
  }
  return {
    notesTotal: notes.length,
    hits,
    wrongFinger: count("wrong"),
    missed: count("missed"),
    hitRate: notes.length > 0 ? hits / notes.length : 0,
    meanTimingErrorMs:
      errors.length > 0 ? errors.reduce((total, error) => total + error, 0) / errors.length : null,
    perFinger,
  };
}

export function melodyOutcome(hitRate: number): "success" | "miss" {
  return hitRate >= SUCCESS_HIT_RATE ? "success" : "miss";
}

/** 25 a note played, plus 50 for a melody played well. Nothing is ever taken away. */
export function melodyScore(metrics: Pick<MelodyMetrics, "hits" | "hitRate">): number {
  return (
    metrics.hits * POINTS_PER_HIT +
    (melodyOutcome(metrics.hitRate) === "success" ? MELODY_BONUS : 0)
  );
}

export interface MelodyRecordInput {
  trialNo: number;
  params: GameParams;
  notes: readonly NoteState[];
  spawnMs: number;
  endMs: number;
  compensation: TrialCompensation;
}

const round = (value: number | null, places = 0) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** places) / 10 ** places;

/** One melody as the server stores it: its notes as the target, and no trajectory. */
export function buildMelodyRecord(input: MelodyRecordInput): TrialCreate {
  const metrics = melodyMetrics(input.notes);
  return {
    trial_no: input.trialNo,
    params: input.params,
    target: { kind: "sequence", notes: input.notes.map((note) => note.finger) },
    outcome: melodyOutcome(metrics.hitRate),
    timings: {
      spawn: 0,
      move_onset: null,
      enter: null,
      dwell_done: null,
      activation_start: null,
      activation_done: null,
      end: round(input.endMs - input.spawnMs),
    },
    metrics: {
      reaction_ms: null,
      movement_ms: null,
      path_length_sw: null,
      straight_dist_sw: null,
      path_efficiency: null,
      peak_speed_sw_s: null,
      activation_latency_ms: null,
      activation_peak: null,
      notes_total: metrics.notesTotal,
      hits: metrics.hits,
      wrong_finger: metrics.wrongFinger,
      missed: metrics.missed,
      hit_rate: round(metrics.hitRate, 4),
      mean_timing_error_ms: round(metrics.meanTimingErrorMs),
      per_finger: metrics.perFinger,
    },
    compensation: input.compensation,
    trajectory: [],
  };
}
