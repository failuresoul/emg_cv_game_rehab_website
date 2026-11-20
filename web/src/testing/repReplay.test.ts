import { describe, expect, it } from "vitest";

import { LandmarkRecorder } from "./landmarkFormat";
import { countReps, repAccuracy } from "./repReplay";
import {
  type FeedFrame,
  generateFrames,
  SYNTH_FRAME_HEIGHT,
  SYNTH_FRAME_WIDTH,
} from "./synthLandmarks";

/** Shared test vectors: scripted movements with a known number of repetitions. */
const VECTORS = [
  {
    exercise: "shoulder_flexion",
    reps: 3,
    steps: [{ do: "raise", plane: "forward", deg: 110, ms: 800, holdMs: 250, back: true }],
  },
  {
    exercise: "shoulder_abduction",
    reps: 4,
    steps: [{ do: "raise", plane: "sideways", deg: 100, ms: 800, holdMs: 250, back: true }],
  },
  {
    exercise: "hand_open_close",
    reps: 5,
    steps: [{ do: "hand", open: 1, ms: 600, holdMs: 250, back: true }],
  },
] as const;

function frames(
  steps: readonly Record<string, unknown>[],
  reps: number,
  start: Record<string, unknown>[] = [],
) {
  return generateFrames({
    affectedSide: "right",
    jitterM: 0.001,
    steps: [
      { do: "still", ms: 500 },
      ...start,
      ...Array.from({ length: reps }, () => steps).flat(),
    ] as never,
  });
}

describe("rep replay", () => {
  it.each(VECTORS)(
    "counts $reps repetitions of $exercise as the warm-up does",
    ({ exercise, reps, steps }) => {
      const start = exercise === "hand_open_close" ? [{ do: "hand", open: 0, ms: 400 }] : [];
      const result = countReps(frames(steps, reps, start), exercise, "right");
      expect(result.counted).toBe(reps);
      expect(result.framesWithMeasure).toBeGreaterThan(0);
    },
  );

  it("counts each marked step of a recording", () => {
    const raise = frames(VECTORS[0].steps, 3);
    const recorder = new LandmarkRecorder(0);
    const asResult = (frame: FeedFrame) => ({
      timestamp: frame.t,
      hand: frame.hands[0]?.landmarks ?? null,
      hands: frame.hands,
      pose: frame.pose,
      poseWorld: frame.poseWorld,
      fps: 30,
      delegate: "GPU" as const,
      brightness: frame.brightness,
      frameWidth: SYNTH_FRAME_WIDTH,
      frameHeight: SYNTH_FRAME_HEIGHT,
    });
    raise.forEach((frame) => recorder.add(asResult(frame)));
    const end = raise[raise.length - 1].t;
    const recording = recorder.toRecording(new Date(0), [
      { id: "raise_forward", name: "Raise forward", start: 0, end },
    ]);
    const rows = repAccuracy(recording, "right");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      marker: "raise_forward",
      exercise: "shoulder_flexion",
      scripted: 3,
      counted: 3,
    });
  });
});

describe("rep replay, raises in the wrong direction", () => {
  const forward = [{ do: "raise", plane: "forward", deg: 110, ms: 800, holdMs: 250, back: true }];
  const sideways = [{ do: "raise", plane: "sideways", deg: 100, ms: 800, holdMs: 250, back: true }];

  it("does not count side raises as forward raises, nor forward raises as side raises", () => {
    const side = (exercise: "shoulder_flexion" | "shoulder_abduction", steps: typeof forward) =>
      countReps(frames(steps, 3), exercise, "right", SYNTH_FRAME_WIDTH, SYNTH_FRAME_HEIGHT);

    expect(side("shoulder_flexion", forward).counted).toBe(3);
    expect(side("shoulder_abduction", sideways).counted).toBe(3);
    expect(side("shoulder_flexion", sideways).counted).toBe(0);
    expect(side("shoulder_abduction", forward).counted).toBe(0);
  });
});
