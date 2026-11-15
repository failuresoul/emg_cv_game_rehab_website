import { describe, expect, it } from "vitest";

import {
  averageFps,
  fitRecording,
  LandmarkRecorder,
  recordingBytes,
} from "@/testing/landmarkFormat";
import { generateFrames, SYNTH_FRAME_HEIGHT, SYNTH_FRAME_WIDTH } from "@/testing/synthLandmarks";

import { GUIDE_STEPS, type GuideStep, stepDurationMs } from "./guideSteps";
import { type GuideEvent, GuideSequencer } from "./sequencer";

const STEPS: GuideStep[] = [
  {
    id: "a",
    name: "Step A",
    instruction: "",
    voice: "a",
    icon: "still",
    beats: [{ label: "A", ms: 2000 }],
  },
  {
    id: "b",
    name: "Step B",
    instruction: "",
    voice: "b",
    icon: "arrow",
    beats: [
      { label: "1", ms: 1000 },
      { label: "2", ms: 1000 },
      { label: "3", ms: 1000 },
    ],
  },
];

/** Runs the sequencer in 50 ms ticks from `from` to `to`, collecting the events. */
function runTo(
  sequencer: GuideSequencer,
  from: number,
  to: number,
  visible: (now: number) => boolean = () => true,
): GuideEvent[] {
  const events: GuideEvent[] = [];
  for (let now = from + 50; now <= to; now += 50) events.push(...sequencer.tick(now, visible(now)));
  return events;
}

const types = (events: GuideEvent[]) => events.map((event) => event.type);

describe("the guided recording's steps", () => {
  it("are the ten steps asked for, with their rhythms", () => {
    expect(GUIDE_STEPS).toHaveLength(10);
    const seconds = GUIDE_STEPS.map((step) => stepDurationMs(step) / 1000);
    expect(seconds).toEqual([5, 24, 12, 12, 30, 20, 12, 12, 10, 5]);
    expect(GUIDE_STEPS[1].beats.map((beat) => beat.directionDeg)).toEqual([
      0, 45, 90, 135, 180, 225, 270, 315,
    ]);
    expect(GUIDE_STEPS[2].beats.map((beat) => beat.label)).toEqual(["1 / 3", "2 / 3", "3 / 3"]);
    expect(GUIDE_STEPS[6].beats.map((beat) => beat.finger)).toEqual([
      "index",
      "middle",
      "ring",
      "little",
      "index",
      "middle",
      "ring",
      "little",
    ]);
    expect(new Set(GUIDE_STEPS.map((step) => step.id)).size).toBe(10);
  });
});

describe("the step sequencer", () => {
  it("runs a 3-2-1 countdown, then each step, and marks when each ran", () => {
    const sequencer = new GuideSequencer(STEPS);
    expect(types(sequencer.start(1000))).toEqual(["countdown"]);
    expect(sequencer.view().countdown).toBe(3);
    expect(sequencer.isRecording).toBe(false);

    runTo(sequencer, 1000, 2050);
    expect(sequencer.view().countdown).toBe(2);
    runTo(sequencer, 2050, 3000);
    expect(sequencer.view().countdown).toBe(1);
    // The countdown began at 1000, so the step starts at 4000: 3000 ms of recording time.
    const started = runTo(sequencer, 3000, 4000);
    expect(started).toContainEqual({ type: "stepStart", stepIndex: 0, atMs: 3000 });
    expect(sequencer.isRecording).toBe(true);
    expect(sequencer.view().secondsLeft).toBe(2);

    const ended = runTo(sequencer, 4000, 6000);
    expect(ended).toContainEqual({ type: "stepEnd", stepIndex: 0, atMs: 5000 });
    expect(ended).toContainEqual({ type: "countdown", stepIndex: 1 });
    expect(sequencer.isRecording).toBe(false);

    const rest = runTo(sequencer, 6000, 12_000);
    expect(rest.filter((event) => event.type === "beat")).toEqual([
      { type: "beat", stepIndex: 1, beatIndex: 0 },
      { type: "beat", stepIndex: 1, beatIndex: 1 },
      { type: "beat", stepIndex: 1, beatIndex: 2 },
    ]);
    expect(types(rest)).toContain("done");
    expect(sequencer.phase).toBe("done");
    expect(sequencer.markers).toEqual([
      { id: "a", name: "Step A", start: 3000, end: 5000 },
      { id: "b", name: "Step B", start: 8000, end: 11_000 },
    ]);
  });

  it("shows the current beat and its progress", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    runTo(sequencer, 0, 8000 - 3000 + 1500 + 3000); // into step B's second beat
    const view = sequencer.view();
    expect(view.stepIndex).toBe(1);
    expect(view.beat?.label).toBe("2");
    expect(view.beatProgress).toBeCloseTo(0.5, 5);
  });

  it("stops the clock while paused and goes on from the same place", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    runTo(sequencer, 0, 4000); // 1 s into step A
    sequencer.pause();
    expect(sequencer.view().paused).toBe(true);
    expect(sequencer.isRecording).toBe(false);
    runTo(sequencer, 4000, 14_000);
    expect(sequencer.view().secondsLeft).toBe(1);
    sequencer.resume(14_000);
    const events = runTo(sequencer, 14_000, 15_000);
    // The step ends 1 s of running time after the resume; the pause is inside its marker.
    expect(events).toContainEqual({ type: "stepEnd", stepIndex: 0, atMs: 15_000 });
    expect(sequencer.markers[0]).toEqual({ id: "a", name: "Step A", start: 3000, end: 15_000 });
  });

  it("pauses the countdown too", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    runTo(sequencer, 0, 1000);
    sequencer.pause();
    runTo(sequencer, 1000, 9000);
    expect(sequencer.view().countdown).toBe(2);
    sequencer.resume(9000);
    expect(runTo(sequencer, 9000, 11_000)).toContainEqual({
      type: "stepStart",
      stepIndex: 0,
      atMs: 11_000,
    });
  });

  it("repeats only the current step, dropping its frames", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    runTo(sequencer, 0, 6000); // step A done (3000-5000), step B counting down
    runTo(sequencer, 6000, 9000); // step B started at 8000
    const events = sequencer.repeatStep(9000);
    expect(events).toEqual([
      { type: "discard", fromMs: 8000 },
      { type: "countdown", stepIndex: 1 },
    ]);
    expect(sequencer.view().countdown).toBe(3);
    runTo(sequencer, 9000, 20_000);
    expect(sequencer.markers.map((marker) => [marker.id, marker.start, marker.end])).toEqual([
      ["a", 3000, 5000],
      ["b", 12_000, 15_000],
    ]);
  });

  it("repeating during the countdown drops nothing", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    runTo(sequencer, 0, 1500);
    expect(sequencer.repeatStep(1500)).toEqual([{ type: "countdown", stepIndex: 0 }]);
  });

  it("pauses when the arm or hand is out of view for over a second, and goes on when seen", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    // Out of view from 3500 to 6000 (step A runs from 3000).
    const hidden = (now: number) => now <= 3500 || now > 6000;
    const events = runTo(sequencer, 0, 6000, hidden);
    expect(types(events)).toContain("autoPause");
    expect(sequencer.view().autoPaused).toBe(true);
    expect(sequencer.isRecording).toBe(false);
    const back = runTo(sequencer, 6000, 6050, hidden);
    expect(types(back)).toEqual(["autoResume"]);
    expect(sequencer.isRecording).toBe(true);
    // Step A ran 1.5 s (3000 to 4500; the pause began at 4550) and goes on at 6050: 0.5 s more.
    const ended = runTo(sequencer, 6050, 7000, hidden);
    const end = ended.find((event) => event.type === "stepEnd");
    expect(end).toEqual({ type: "stepEnd", stepIndex: 0, atMs: 6550 });
  });

  it("does not pause for a short loss of view", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    const events = runTo(sequencer, 0, 5000, (now) => now < 3200 || now > 4000);
    expect(types(events)).not.toContain("autoPause");
    expect(types(events)).toContain("stepEnd");
  });

  it("ignores loss of view during the countdown", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    expect(types(runTo(sequencer, 0, 2900, () => false))).not.toContain("autoPause");
  });

  it("cancels", () => {
    const sequencer = new GuideSequencer(STEPS);
    sequencer.start(0);
    sequencer.cancel();
    expect(sequencer.phase).toBe("cancelled");
    expect(runTo(sequencer, 0, 10_000)).toEqual([]);
  });
});

describe("the guided recording's file", () => {
  const frames = generateFrames({ affectedSide: "left", steps: [{ do: "still", ms: 4000 }] });
  const resultAt = (index: number, startMs: number) => {
    const frame = frames[index];
    return {
      timestamp: startMs + frame.t,
      hand: frame.hands[0]?.landmarks ?? null,
      hands: frame.hands,
      pose: frame.pose,
      poseWorld: frame.poseWorld,
      fps: 30,
      delegate: "GPU" as const,
      brightness: frame.brightness,
      frameWidth: SYNTH_FRAME_WIDTH,
      frameHeight: SYNTH_FRAME_HEIGHT,
    };
  };

  it("times frames from the recording's start and drops a redone step's frames", () => {
    const recorder = new LandmarkRecorder(500);
    for (let i = 0; i < frames.length; i++) recorder.add(resultAt(i, 1000));
    expect(recorder.frameTimes[0]).toBe(500);
    recorder.discardFrom(2000);
    expect(Math.max(...recorder.frameTimes)).toBeLessThan(2000);
    const recording = recorder.toRecording(new Date(0), [
      { id: "a", name: "A", start: 500, end: 1900 },
    ]);
    expect(recording.markers).toEqual([{ id: "a", name: "A", start: 500, end: 1900 }]);
  });

  it("leaves out every second frame until the file fits, keeping the markers", () => {
    const recorder = new LandmarkRecorder();
    for (let i = 0; i < frames.length; i++) recorder.add(resultAt(i, 0));
    const full = recorder.toRecording(new Date(0), [{ id: "a", name: "A", start: 0, end: 4000 }]);
    const size = recordingBytes(full);
    const fitted = fitRecording(full, size * 0.6);
    expect(fitted.halvings).toBe(1);
    expect(fitted.recording.thinned).toBe(true);
    expect(fitted.recording.frames).toHaveLength(Math.ceil(full.frames.length / 2));
    expect(fitted.recording.markers).toEqual(full.markers);
    expect(fitRecording(full, size).halvings).toBe(0);
  });

  it("averages the frame rate without the pauses between steps", () => {
    const times = [0, 33, 67, 100, 5000, 5033, 5067];
    expect(averageFps(times)).toBeCloseTo(30, 0);
    expect(averageFps([0])).toBe(0);
  });
});
