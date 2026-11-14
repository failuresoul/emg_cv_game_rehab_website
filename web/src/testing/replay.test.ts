import { describe, expect, it } from "vitest";

import { computeJointAngles } from "@/vision/angles";
import type { VisionResult } from "@/vision/visionEngine";

import {
  decodeFrame,
  encodeFrame,
  LandmarkRecorder,
  type LandmarkRecording,
  parseRecording,
  ReplayClock,
  serialiseRecording,
} from "./landmarkFormat";
import {
  type FeedFrame,
  generateFrames,
  SYNTH_FRAME_HEIGHT,
  SYNTH_FRAME_WIDTH,
} from "./synthLandmarks";
import { type FrameSource, RecordingSource, ReplayRunner, SyntheticSource } from "./visionFeed";

function asResult(frame: FeedFrame, startMs = 1000): VisionResult {
  return {
    timestamp: startMs + frame.t,
    hand: frame.hands[0]?.landmarks ?? null,
    hands: frame.hands,
    pose: frame.pose,
    poseWorld: frame.poseWorld,
    fps: 30,
    delegate: "GPU",
    brightness: frame.brightness,
    frameWidth: SYNTH_FRAME_WIDTH,
    frameHeight: SYNTH_FRAME_HEIGHT,
  };
}

function record(frames: FeedFrame[]): LandmarkRecording {
  const recorder = new LandmarkRecorder();
  for (const frame of frames) recorder.add(asResult(frame));
  return recorder.toRecording(new Date("2026-11-14T10:00:00Z"));
}

/** Fake timers: time moves only when the test says. */
function fakeTimers() {
  let now = 0;
  let callback: (() => void) | null = null;
  return {
    timers: {
      now: () => now,
      setTimer: (next: () => void) => {
        callback = next;
        return 1;
      },
      clearTimer: () => {
        callback = null;
      },
    },
    /** Moves time on in 8 ms checks, as the runner's interval would. */
    advance(ms: number) {
      const end = now + ms;
      while (now + 8 <= end) {
        now += 8;
        callback?.();
      }
      now = end;
      callback?.();
    },
    get running() {
      return callback !== null;
    },
  };
}

const RAISE = generateFrames({
  affectedSide: "left",
  steps: [{ do: "raise", plane: "forward", deg: 80, ms: 1000, holdMs: 500 }],
  jitterM: 0.001,
});

describe("landmark recordings", () => {
  it("round-trips a frame at 4 decimals, times from the first frame", () => {
    const frame = RAISE[20];
    const encoded = encodeFrame(asResult(frame, 5000), 5000 - 12.34567);
    expect(encoded.t).toBeCloseTo(frame.t + 12.3457, 3);
    const decoded = decodeFrame(encoded);
    expect(decoded.pose).toHaveLength(33);
    expect(decoded.hands[0].landmarks).toHaveLength(21);
    expect(decoded.hands[0].worldLandmarks).toHaveLength(21);
    for (let i = 0; i < 33; i++) {
      expect(Math.abs(decoded.pose![i].x - frame.pose![i].x)).toBeLessThanOrEqual(0.00005);
      expect(decoded.poseWorld![i].visibility).toBeCloseTo(frame.poseWorld![i].visibility, 4);
    }
    expect(decoded.hands[0].handedness).toBe(frame.hands[0].handedness);
    expect(decoded.brightness).toBe(frame.brightness);
  });

  it("measures the same angles after recording and replaying", () => {
    const original = computeJointAngles(asResult(RAISE[RAISE.length - 1]), "left");
    const recording = parseRecording(JSON.parse(serialiseRecording(record(RAISE))));
    const replayed = decodeFrame(recording.frames[recording.frames.length - 1]);
    const again = computeJointAngles(asResult(replayed), "left");
    expect(again.armElevationDeg!.value).toBeCloseTo(original.armElevationDeg!.value, 1);
    expect(again.elbowFlexionDeg!.value).toBeCloseTo(original.elbowFlexionDeg!.value, 1);
  });

  it("keeps a 2-minute recording under 15 MB", () => {
    const frames = generateFrames({
      affectedSide: "right",
      loop: false,
      steps: [
        { do: "reach", to: { x: 0.9, y: 0.2 }, ms: 1500, holdMs: 500, back: true },
        { do: "hand", open: 0, ms: 500, holdMs: 500, back: true },
      ],
    });
    // Repeat to two minutes at 30 frames a second, with times running on.
    const twoMinutes: FeedFrame[] = [];
    for (let i = 0; i < 3600; i++) {
      const source = frames[i % frames.length];
      twoMinutes.push({ ...source, t: (i * 1000) / 30 });
    }
    const text = serialiseRecording(record(twoMinutes));
    const bytes = new TextEncoder().encode(text).length;
    expect(bytes).toBeLessThan(15 * 1024 * 1024);
    expect(bytes).toBeGreaterThan(5 * 1024 * 1024);
    const recorder = new LandmarkRecorder();
    for (const frame of twoMinutes.slice(0, 300)) recorder.add(asResult(frame));
    // The recorder's estimate is close to the real size.
    const real = new TextEncoder().encode(serialiseRecording(recorder.toRecording())).length;
    expect(Math.abs(recorder.approximateBytes - real) / real).toBeLessThan(0.02);
  });

  it("refuses files that are not recordings", () => {
    expect(() => parseRecording({ format: "other" })).toThrow(/Not a landmark recording/);
    expect(() => parseRecording({ format: "muvi-landmarks", version: 2, frames: [] })).toThrow(
      /version/,
    );
    expect(() => parseRecording({ format: "muvi-landmarks", version: 1, frames: [] })).toThrow(
      /no frames/,
    );
    const backwards = record(RAISE.slice(0, 3));
    backwards.frames[2].t = 1;
    expect(() => parseRecording(backwards)).toThrow(/backwards/);
  });
});

describe("the replay clock", () => {
  const clock = new ReplayClock([0, 33, 67, 100], false);

  it("gives the latest frame whose time has come", () => {
    expect(clock.at(0).index).toBe(0);
    expect(clock.at(32.9).index).toBe(0);
    expect(clock.at(33).index).toBe(1);
    expect(clock.at(80).index).toBe(2);
    expect(clock.at(100).index).toBe(3);
  });

  it("holds the last frame after the end without looping", () => {
    expect(clock.at(5000)).toEqual({ index: 3, loop: 0, ended: true });
  });

  it("loops one frame interval after the last frame", () => {
    const looping = new ReplayClock([0, 33, 67, 100], true);
    expect(looping.periodMs).toBeCloseTo(133.33, 1);
    expect(looping.at(120)).toEqual({ index: 3, loop: 0, ended: false });
    expect(looping.at(134)).toEqual({ index: 0, loop: 1, ended: false });
    expect(looping.at(133.4 + 40).index).toBe(1);
  });

  it("starts at the first frame's own time", () => {
    const offset = new ReplayClock([500, 533, 566], false);
    expect(offset.at(0).index).toBe(0);
    expect(offset.at(40).index).toBe(1);
  });
});

describe("the replay runner", () => {
  const recording = record(RAISE);

  function run(source: FrameSource | (() => FrameSource | null)) {
    const fake = fakeTimers();
    const results: VisionResult[] = [];
    const getSource = typeof source === "function" ? source : () => source;
    const runner = new ReplayRunner(getSource, (result) => results.push(result), fake.timers);
    return { fake, results, runner };
  }

  it("emits each recorded frame once, in real time, spaced as recorded", () => {
    const source = new RecordingSource(recording, false);
    const { fake, results, runner } = run(source);
    runner.start();
    expect(results).toHaveLength(1);
    fake.advance(500);
    // Frames at 0, 33.3 ... 500 ms: 16 of them.
    expect(results).toHaveLength(16);
    fake.advance(1000);
    expect(results).toHaveLength(RAISE.length);
    fake.advance(2000);
    // Not looping: nothing more after the last frame.
    expect(results).toHaveLength(RAISE.length);
    const gaps = results.slice(1).map((result, i) => result.timestamp - results[i].timestamp);
    for (const gap of gaps) expect(gap).toBeCloseTo(1000 / 30, 3);
    expect(results[0].frameWidth).toBe(640);
    expect(results[results.length - 1].fps).toBeGreaterThan(29);
    runner.stop();
    expect(fake.running).toBe(false);
  });

  it("is no later than one check behind each frame's time", () => {
    const source = new RecordingSource(recording, false);
    const fake = fakeTimers();
    const lags: number[] = [];
    const runner = new ReplayRunner(
      () => source,
      (result) => lags.push(fake.timers.now() - result.timestamp),
      fake.timers,
    );
    runner.start();
    fake.advance(1500);
    for (const lag of lags) {
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThanOrEqual(8);
    }
  });

  it("loops a recording with timestamps still rising", () => {
    const source = new RecordingSource(recording, true);
    const { fake, results, runner } = run(source);
    runner.start();
    fake.advance(3 * 1533 + 100);
    expect(results.length).toBeGreaterThan(3 * RAISE.length);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].timestamp).toBeGreaterThan(results[i - 1].timestamp);
    }
    // The second loop shows the first frame again.
    expect(results[RAISE.length].pose).toEqual(results[0].pose);
  });

  it("starts a new source from its beginning, and stops emitting when cleared", () => {
    let current: FrameSource | null = new RecordingSource(recording, false);
    const { fake, results, runner } = run(() => current);
    runner.start();
    fake.advance(1000);
    const before = results.length;
    current = new SyntheticSource({ affectedSide: "left", steps: [{ do: "still", ms: 500 }] });
    fake.advance(8);
    expect(results.length).toBe(before + 1);
    fake.advance(500);
    expect(results.length).toBe(before + 1 + 15);
    current = null;
    fake.advance(500);
    expect(results.length).toBe(before + 1 + 15);
  });

  it("plays a synthetic script in real time at its frame rate", () => {
    const source = new SyntheticSource({
      affectedSide: "right",
      fps: 20,
      steps: [{ do: "still", ms: 1000 }],
    });
    const { fake, results, runner } = run(source);
    runner.start();
    fake.advance(1000);
    expect(results).toHaveLength(21);
    expect(results[1].timestamp - results[0].timestamp).toBeCloseTo(50, 6);
  });
});
