import { describe, expect, it } from "vitest";

import type { Finger } from "@/input/fingerTouch";

import type { NoteState, NoteStatus } from "./melodyMachine";
import { fingerPianoDefaults, melodyToParams, readParams } from "./params";
import { buildMelodyRecord, melodyMetrics, melodyOutcome, melodyScore } from "./trialRecord";

const note = (
  finger: Finger,
  status: NoteStatus,
  errorMs: number | null = null,
  wrongTouches = 0,
): NoteState => ({ finger, arrivalMs: 0, status, errorMs, wrongTouches });

const NOTES: NoteState[] = [
  note("index", "hit", -200),
  note("middle", "hit", 100),
  note("middle", "wrong", null, 1),
  note("little", "hit", 300),
  note("index", "missed"),
];

describe("melodyMetrics", () => {
  it("counts every note once, as a hit, a wrong finger or missed", () => {
    const metrics = melodyMetrics(NOTES);
    expect(metrics).toMatchObject({ notesTotal: 5, hits: 3, wrongFinger: 1, missed: 1 });
    expect(metrics.hits + metrics.wrongFinger + metrics.missed).toBe(metrics.notesTotal);
    expect(metrics.hitRate).toBeCloseTo(0.6);
  });

  it("averages the absolute timing error of the hits only", () => {
    expect(melodyMetrics(NOTES).meanTimingErrorMs).toBeCloseTo(200);
    expect(melodyMetrics([note("ring", "missed")]).meanTimingErrorMs).toBeNull();
  });

  it("tallies hits and notes asked for each finger used", () => {
    expect(melodyMetrics(NOTES).perFinger).toEqual({
      index: { hits: 1, attempts: 2 },
      middle: { hits: 1, attempts: 2 },
      little: { hits: 1, attempts: 1 },
    });
  });

  it("is all zero for an empty melody", () => {
    expect(melodyMetrics([])).toMatchObject({ notesTotal: 0, hits: 0, hitRate: 0 });
  });
});

describe("melodyOutcome", () => {
  it("is a success from 75% of notes played", () => {
    expect(melodyOutcome(0.75)).toBe("success");
    expect(melodyOutcome(1)).toBe("success");
    expect(melodyOutcome(0.74)).toBe("miss");
    expect(melodyOutcome(0)).toBe("miss");
  });
});

describe("melodyScore", () => {
  it("gives 25 a note, plus 50 for a melody played well", () => {
    expect(melodyScore({ hits: 3, hitRate: 0.75 })).toBe(125);
    expect(melodyScore({ hits: 2, hitRate: 0.5 })).toBe(50);
    expect(melodyScore({ hits: 0, hitRate: 0 })).toBe(0);
  });
});

describe("buildMelodyRecord", () => {
  it("saves the melody as a sequence target with the note metrics", () => {
    const record = buildMelodyRecord({
      trialNo: 2,
      params: melodyToParams(NOTES.map((item) => item.finger)),
      notes: NOTES,
      spawnMs: 1000,
      endMs: 16_500,
      compensation: { flagged: false, type: null, max_values: {} },
    });
    expect(record.target).toEqual({
      kind: "sequence",
      notes: ["index", "middle", "middle", "little", "index"],
    });
    expect(record.outcome).toBe("miss");
    expect(record.trajectory).toEqual([]);
    expect(record.timings.end).toBe(15_500);
    expect(record.metrics).toMatchObject({
      notes_total: 5,
      hits: 3,
      wrong_finger: 1,
      missed: 1,
      hit_rate: 0.6,
      mean_timing_error_ms: 200,
      per_finger: { little: { hits: 1, attempts: 1 } },
    });
  });
});

describe("finger piano settings", () => {
  it("reads the melody from note_1, note_2 …", () => {
    const params = { finger_count: 3, ...melodyToParams(["ring", "index", "middle"]) };
    const settings = readParams(params);
    expect(settings.notes).toEqual(["ring", "index", "middle"]);
    expect(settings.fingers).toEqual(["index", "middle", "ring"]);
    expect(settings.hitWindowMs).toBe(1200);
  });

  it("keeps the touch distance between 0.2 and 0.4", () => {
    expect(readParams({ touch_threshold: 0.1 }).touchThreshold).toBe(0.2);
    expect(readParams({ touch_threshold: 0.6 }).touchThreshold).toBe(0.4);
    expect(readParams({}).touchThreshold).toBe(0.3);
  });

  type Thumb = Parameters<typeof fingerPianoDefaults>[0][number];
  const thumb = (changes: Partial<Thumb> = {}): Thumb => ({
    exerciseId: "thumb_opposition",
    skipped: false,
    preset: "standard",
    thresholds: { low: 0.25, high: 0.4 },
    ...changes,
  });

  it("starts from the patient's warm-up touch distance", () => {
    expect(fingerPianoDefaults([thumb()])).toEqual({ touch_threshold: 0.25 });
    expect(fingerPianoDefaults([thumb({ thresholds: { low: 0.5, high: 0.65 } })])).toEqual({
      touch_threshold: 0.4,
    });
  });

  it("starts with index and middle after a gentle warm-up", () => {
    expect(
      fingerPianoDefaults([thumb({ preset: "gentle", thresholds: { low: 0.35, high: 0.5 } })]),
    ).toEqual({ touch_threshold: 0.35, finger_count: 2 });
  });

  it("keeps the defaults without a thumb opposition warm-up", () => {
    expect(fingerPianoDefaults([])).toEqual({});
    expect(fingerPianoDefaults([thumb({ skipped: true, preset: "gentle" })])).toEqual({});
  });
});
