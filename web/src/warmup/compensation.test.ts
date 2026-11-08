import { describe, expect, it } from "vitest";

import { POSE } from "@/vision/landmarks";
import { computePosture, type PostureSample } from "@/vision/posture";

import { CompensationMonitor, compensationValues, cueFor, exceededTypes } from "./compensation";
import { COMPENSATION_CONFIG } from "./compensationConfig";
import { type ExerciseEvent, ExerciseRunner } from "./exerciseRunner";
import { type ExerciseDefinition, EXERCISES } from "./exercises";
import { cycles, FRAME_MS, hold } from "./testSignals";

// World landmarks in metres: shoulders 0.4 m apart, so one shoulder width (SW) is 0.4 m.
const SW = 0.4;

interface Shift {
  /** Forward movement of both shoulders, in SW. */
  forward?: number;
  /** Rise of the affected shoulder only, in SW. */
  hike?: number;
  /** Forward tilt of the trunk about the hips, in degrees. */
  leanDeg?: number;
  hipsVisible?: boolean;
}

/** A posture with +y up and the hips at the origin, shifted from upright. */
function posture({
  forward = 0,
  hike = 0,
  leanDeg = 0,
  hipsVisible = true,
}: Shift = {}): PostureSample {
  const radians = (leanDeg * Math.PI) / 180;
  const height = 0.5;
  const midpoint = {
    x: 0,
    y: height * Math.cos(radians) + (hike * SW) / 2,
    z: height * Math.sin(radians) + forward * SW,
  };
  return {
    shoulderMidpoint: midpoint,
    shoulderWidth: SW,
    affectedShoulderRise: hike * SW,
    trunkVector: hipsVisible ? { x: 0, y: -midpoint.y, z: -midpoint.z } : null,
    shoulderLine: { x: SW, y: hike * SW, z: 0 },
    source: "3d",
  };
}

/** Upright posture for 2 seconds, which becomes the baseline. */
function withBaseline(exerciseId: ExerciseDefinition["id"] = "shoulder_flexion") {
  const monitor = new CompensationMonitor(exerciseId);
  for (const { timestamp } of hold(0, 2000)) monitor.addSample(posture(), timestamp);
  expect(monitor.baseline).not.toBeNull();
  return monitor;
}

describe("computePosture", () => {
  function world(options: { rise?: number; hipVisibility?: number } = {}) {
    const { rise = 0, hipVisibility = 1 } = options;
    const point = (x: number, y: number, z: number, visibility = 1) => ({ x, y, z, visibility });
    const landmarks = Array.from({ length: 33 }, () => point(0, 0, 0, 0.9));
    // MediaPipe's y is down, so rising means a smaller y.
    landmarks[POSE.LEFT_SHOULDER] = point(0.2, -0.5 - rise, 0);
    landmarks[POSE.RIGHT_SHOULDER] = point(-0.2, -0.5, 0);
    landmarks[POSE.LEFT_HIP] = point(0.1, 0, 0, hipVisibility);
    landmarks[POSE.RIGHT_HIP] = point(-0.1, 0, 0, hipVisibility);
    return { pose: null, poseWorld: landmarks, frameWidth: 640, frameHeight: 480 };
  }

  it("measures the affected shoulder's rise, with +y up", () => {
    expect(computePosture(world({ rise: 0.04 }), "left")?.affectedShoulderRise).toBeCloseTo(0.04);
    // The same pose seen from the other side: the affected shoulder is now the lower one.
    expect(computePosture(world({ rise: 0.04 }), "right")?.affectedShoulderRise).toBeCloseTo(-0.04);
  });

  it("gives the trunk from the shoulders down to the hips, or null if the hips are hidden", () => {
    const upright = computePosture(world(), "left");

    expect(upright?.trunkVector?.y).toBeCloseTo(-0.5);
    expect(upright?.shoulderWidth).toBeCloseTo(SW);
    expect(upright?.source).toBe("3d");
    expect(computePosture(world({ hipVisibility: 0.2 }), "left")?.trunkVector).toBeNull();
  });

  it("falls back to image pixels, and needs both shoulders", () => {
    const image = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    image[POSE.LEFT_SHOULDER] = { x: 0.6, y: 0.4, z: 0, visibility: 1 };
    image[POSE.RIGHT_SHOULDER] = { x: 0.4, y: 0.4, z: 0, visibility: 1 };
    const flat = { pose: image, poseWorld: null, frameWidth: 640, frameHeight: 480 };

    expect(computePosture(flat, "left")?.source).toBe("2d");
    expect(computePosture(flat, "left")?.shoulderWidth).toBeCloseTo(128);
    image[POSE.RIGHT_SHOULDER] = { x: 0.4, y: 0.4, z: 0, visibility: 0.1 };
    expect(computePosture(flat, "left")).toBeNull();
  });
});

describe("compensation values", () => {
  const baseline = {
    shoulderMidpoint: posture().shoulderMidpoint,
    shoulderWidth: SW,
    affectedShoulderRise: 0,
    trunkVector: posture().trunkVector,
    shoulderLine: posture().shoulderLine,
  };

  it("are zero when upright", () => {
    expect(compensationValues(posture(), baseline)).toEqual({
      trunkDisplacement: 0,
      trunkLeanDeg: 0,
      shoulderHike: 0,
    });
  });

  it("measure a forward shift in shoulder widths", () => {
    expect(compensationValues(posture({ forward: 0.2 }), baseline).trunkDisplacement).toBeCloseTo(
      0.2,
    );
  });

  it("measure a lean in degrees, from the hips or else the shoulder line", () => {
    expect(compensationValues(posture({ leanDeg: 15 }), baseline).trunkLeanDeg).toBeCloseTo(15);

    const sideways = posture({ hipsVisible: false });
    sideways.shoulderLine = { x: SW * Math.cos(0.2), y: SW * Math.sin(0.2), z: 0 };
    expect(
      compensationValues(sideways, { ...baseline, trunkVector: null }).trunkLeanDeg,
    ).toBeCloseTo((0.2 * 180) / Math.PI);
  });

  it("count only a rise of the shoulder, not a drop", () => {
    expect(compensationValues(posture({ hike: 0.1 }), baseline).shoulderHike).toBeCloseTo(0.1);
    expect(compensationValues(posture({ hike: -0.1 }), baseline).shoulderHike).toBe(0);
  });

  it("use the shared thresholds", () => {
    expect(COMPENSATION_CONFIG.thresholds).toEqual({
      trunkDisplacement: 0.15,
      trunkLeanDeg: 10,
      shoulderHike: 0.08,
    });
    expect(
      exceededTypes({ trunkDisplacement: 0.16, trunkLeanDeg: 11, shoulderHike: 0.09 }),
    ).toEqual(["trunk", "lean", "shoulder"]);
    expect(exceededTypes({ trunkDisplacement: 0.14, trunkLeanDeg: 9, shoulderHike: 0.07 })).toEqual(
      [],
    );
  });

  it("choose the back cue for the trunk and lean, and the shoulder cue otherwise", () => {
    expect(cueFor(["trunk", "shoulder"])).toBe("back");
    expect(cueFor(["lean"])).toBe("back");
    expect(cueFor(["shoulder"])).toBe("shoulder");
    expect(cueFor([])).toBeNull();
  });
});

describe("CompensationMonitor", () => {
  it("has no values until the 2-second baseline is done", () => {
    const monitor = new CompensationMonitor("shoulder_flexion");

    expect(monitor.addSample(posture({ forward: 0.5 }), 0).values).toBeNull();
    expect(monitor.addSample(posture(), 1000).baseline).toBeNull();
    expect(monitor.addSample(posture(), 2000).baseline).not.toBeNull();
  });

  it("needs a threshold exceeded for 300 ms", () => {
    const monitor = withBaseline();
    let time = 2100;

    for (; time < 2350; time += FRAME_MS) monitor.addSample(posture({ forward: 0.2 }), time);
    expect(monitor.reading.sustained).toEqual([]);
    for (; time < 2450; time += FRAME_MS) monitor.addSample(posture({ forward: 0.2 }), time);
    expect(monitor.reading.sustained).toEqual(["trunk"]);
  });

  it("starts the 300 ms again after a gap", () => {
    const monitor = withBaseline();

    monitor.addSample(posture({ forward: 0.2 }), 2100);
    monitor.addSample(posture({ forward: 0.2 }), 2300);
    monitor.addSample(null, 2333);
    monitor.addSample(posture({ forward: 0.2 }), 2366);
    monitor.addSample(posture({ forward: 0.2 }), 2500);

    expect(monitor.reading.sustained).toEqual([]);
  });

  it("cues at most once every 5 seconds", () => {
    const monitor = withBaseline();
    const cues: number[] = [];

    // Leaning for 12 seconds without a break.
    for (let time = 2100; time < 14_100; time += FRAME_MS) {
      if (monitor.addSample(posture({ leanDeg: 20 }), time).cue) cues.push(time);
    }

    expect(cues).toHaveLength(3);
    expect(cues[1] - cues[0]).toBeGreaterThanOrEqual(5000);
    expect(cues[2] - cues[1]).toBeGreaterThanOrEqual(5000);
  });

  it("does not cue twice for two short episodes close together", () => {
    const monitor = withBaseline();
    const cues: string[] = [];
    const episode = (start: number) => {
      for (let time = start; time < start + 600; time += FRAME_MS) {
        const { cue } = monitor.addSample(posture({ hike: 0.12 }), time);
        if (cue) cues.push(cue);
      }
      monitor.addSample(posture(), start + 700);
    };

    episode(2100);
    episode(4000);
    episode(8000);

    expect(cues).toEqual(["shoulder", "shoulder"]);
  });

  it("checks only trunk displacement for hand exercises", () => {
    const monitor = withBaseline("hand_open_close");

    // The shoulder line tilts and one shoulder rises, but the midpoint moves only 0.1 SW.
    for (let time = 2100; time < 3000; time += FRAME_MS) {
      monitor.addSample(posture({ hike: 0.2 }), time);
    }
    expect(monitor.reading.sustained).toEqual([]);
    expect(monitor.reading.values?.shoulderHike).toBeCloseTo(0.2);

    for (let time = 3000; time < 4000; time += FRAME_MS) {
      monitor.addSample(posture({ forward: 0.3 }), time);
    }
    expect(monitor.reading.sustained).toEqual(["trunk"]);
  });

  it("starts again when re-baselined", () => {
    const monitor = withBaseline();
    monitor.rebaseline();

    expect(monitor.baseline).toBeNull();
    // The new baseline is the shifted posture, which then counts as upright.
    for (const { timestamp } of hold(0, 2000, 3000)) {
      monitor.addSample(posture({ forward: 0.3 }), timestamp);
    }
    monitor.addSample(posture({ forward: 0.3 }), 5100);
    expect(monitor.reading.values?.trunkDisplacement).toBeCloseTo(0);
  });
});

describe("ExerciseRunner compensation", () => {
  const FLEXION = EXERCISES.shoulder_flexion;
  const REST = 10;
  const PEAK = 110;
  const PERIOD_MS = 3000;
  /** Reps start after the 2-second baseline at rest. */
  const REPS_START = 2100;

  /**
   * An active runner fed a baseline at rest, then `count` reps, with the posture at each moment
   * from `postureAt`, which gets the time since the reps began.
   */
  function run(
    postureAt: (sinceStart: number) => Shift,
    definition: ExerciseDefinition = FLEXION,
    count = 3,
    signal = { rest: REST, peak: PEAK },
  ) {
    const runner = new ExerciseRunner(definition, "standard");
    const list: ExerciseEvent[] = [];
    runner.subscribe((event) => list.push(event));
    runner.startCountdown(-3000);
    for (const { timestamp } of hold(0, 2000)) {
      runner.update({ timestamp, value: signal.rest, posture: posture() });
    }
    const samples = cycles({ ...signal, cycles: count, periodMs: PERIOD_MS, startTs: REPS_START });
    for (const { value, timestamp } of samples) {
      runner.update({ timestamp, value, posture: posture(postureAt(timestamp - REPS_START)) });
    }
    runner.skip(REPS_START + count * PERIOD_MS + 100);
    const result = runner.getResult();
    if (!result) throw new Error("no result");
    const feedback = list.flatMap((event) => (event.type === "feedback" ? [event.feedback] : []));
    return { result, feedback };
  }

  it("finds nothing in an upright sequence", () => {
    const { result, feedback } = run(() => ({}));

    expect(result.fullReps).toBe(3);
    expect(result.compensatedReps).toBe(0);
    expect(result.compensationRate).toBe(0);
    expect(result.reps.every((rep) => !rep.compensated)).toBe(true);
    expect(feedback).not.toContain("compensation_back");
    // Each rep still has its largest values recorded.
    expect(result.reps[0].compensationMax?.trunkDisplacement).toBeCloseTo(0);
  });

  it("flags a rep with a 0.2 SW forward shift held for 500 ms, and still counts it", () => {
    // In the middle of the second rep.
    const { result, feedback } = run((since) =>
      since >= 3800 && since < 4300 ? { forward: 0.2 } : {},
    );

    expect(result.fullReps).toBe(3);
    expect(result.reps.map((rep) => rep.compensated)).toEqual([false, true, false]);
    expect(result.reps[1].compensationTypes).toEqual(["trunk"]);
    expect(result.reps[1].compensationMax?.trunkDisplacement).toBeCloseTo(0.2);
    expect(result.compensatedReps).toBe(1);
    expect(result.compensationRate).toBeCloseTo(1 / 3);
    expect(feedback).toContain("compensation_back");
  });

  it("ignores a 200 ms spike", () => {
    const { result, feedback } = run((since) =>
      since >= 3800 && since < 4000 ? { forward: 0.3 } : {},
    );

    expect(result.compensatedReps).toBe(0);
    expect(feedback).not.toContain("compensation_back");
    // The spike is still in the rep's largest values.
    expect(result.reps[1].compensationMax?.trunkDisplacement).toBeCloseTo(0.3);
  });

  it("flags a 0.1 SW shoulder rise as shoulder compensation", () => {
    const { result, feedback } = run((since) =>
      since >= 600 && since < 2400 ? { hike: 0.1 } : {},
    );

    expect(result.reps[0].compensationTypes).toEqual(["shoulder"]);
    expect(result.reps[0].compensationMax?.shoulderHike).toBeCloseTo(0.1);
    expect(feedback).toContain("compensation_shoulder");
  });

  it("ignores a shoulder rise during a hand exercise", () => {
    const { result, feedback } = run(
      (since) => (since >= 600 && since < 2400 ? { hike: 0.1 } : {}),
      EXERCISES.hand_open_close,
      3,
      { rest: 1.0, peak: 1.8 },
    );

    expect(result.fullReps).toBe(3);
    expect(result.compensatedReps).toBe(0);
    expect(feedback).not.toContain("compensation_shoulder");
  });

  it("does not check posture when frames carry none", () => {
    const runner = new ExerciseRunner(FLEXION, "standard");
    runner.startCountdown(-3000);
    runner.update({ timestamp: 0, value: REST });

    expect(runner.compensation.baseline).toBeNull();
    expect(runner.isCompensating).toBe(false);
  });
});
