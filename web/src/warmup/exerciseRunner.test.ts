import { describe, expect, it } from "vitest";

import { type ExerciseEvent, type ExerciseFrame, ExerciseRunner } from "./exerciseRunner";
import { type ExerciseDefinition, EXERCISES } from "./exercises";
import { cycles, FRAME_MS, hold, type Sample } from "./testSignals";

const FLEXION = EXERCISES.shoulder_flexion;
const COUNTDOWN_MS = 3000;

function events(runner: ExerciseRunner): ExerciseEvent[] {
  const list: ExerciseEvent[] = [];
  runner.subscribe((event) => list.push(event));
  return list;
}

function feedbackOf(list: ExerciseEvent[]) {
  return list.flatMap((event) => (event.type === "feedback" ? [event.feedback] : []));
}

/** A runner that has just gone ACTIVE at time 0. */
function activeRunner(
  definition: ExerciseDefinition = FLEXION,
  preset: "standard" | "gentle" = "standard",
) {
  const runner = new ExerciseRunner(definition, preset);
  runner.startDemo();
  runner.startCountdown(-COUNTDOWN_MS);
  runner.update({ timestamp: 0, value: 10 });
  expect(runner.state).toBe("ACTIVE");
  return runner;
}

function feed(runner: ExerciseRunner, samples: Sample[], extra: Partial<ExerciseFrame> = {}) {
  for (const { value, timestamp } of samples) runner.update({ value, timestamp, ...extra });
}

describe("ExerciseRunner states", () => {
  it("goes INTRO, DEMO, COUNTDOWN, ACTIVE", () => {
    const runner = new ExerciseRunner(FLEXION, "standard");
    const seen: string[] = [runner.state];
    runner.subscribe((event) => {
      if (event.type === "stateChanged") seen.push(event.state);
    });

    runner.startDemo();
    runner.startCountdown(1000);
    runner.update({ timestamp: 1000 + COUNTDOWN_MS - 1, value: 10 });
    expect(runner.state).toBe("COUNTDOWN");
    runner.update({ timestamp: 1000 + COUNTDOWN_MS, value: 10 });

    expect(seen).toEqual(["INTRO", "DEMO", "COUNTDOWN", "ACTIVE"]);
  });

  it("can skip the demo", () => {
    const runner = new ExerciseRunner(FLEXION, "standard");

    runner.startCountdown(0);

    expect(runner.state).toBe("COUNTDOWN");
  });

  it("counts nothing during the countdown", () => {
    const runner = new ExerciseRunner(FLEXION, "standard");
    runner.startCountdown(0);

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, periodMs: 2000 }));

    expect(runner.fullReps).toBe(0);
  });

  it("uses a custom countdown", () => {
    const runner = new ExerciseRunner(FLEXION, "standard", { countdownMs: 100 });
    runner.startCountdown(0);

    runner.update({ timestamp: 100, value: 10 });

    expect(runner.state).toBe("ACTIVE");
  });

  it("has no result until it ends", () => {
    expect(activeRunner().getResult()).toBeNull();
  });
});

describe("ExerciseRunner finishing", () => {
  it("reaches DONE at 10 reps and stops counting", () => {
    const runner = activeRunner();

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 12, startTs: FRAME_MS, noiseDeg: 2 }));

    expect(runner.state).toBe("DONE");
    expect(runner.fullReps).toBe(10);
  });

  it("reaches DONE at the time limit with fewer reps", () => {
    const runner = activeRunner();

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 2, startTs: FRAME_MS }));
    feed(runner, hold(10, 90000, 6100));

    expect(runner.state).toBe("DONE");
    const result = runner.getResult();
    expect(result?.fullReps).toBe(2);
    expect(result?.skipped).toBe(false);
    expect(result?.activeTimeMs).toBeGreaterThanOrEqual(90000);
    expect(result?.activeTimeMs).toBeLessThan(90100);
  });

  it("ends at the time limit even with no measure", () => {
    const runner = activeRunner();

    // Short gaps never reach the tracking-lost limit, so time must still run out.
    for (let t = 0; t <= 90400; t += 400) {
      runner.update({ timestamp: t, value: t % 800 === 0 ? 10 : null });
    }

    expect(runner.state).toBe("DONE");
  });

  it("can be skipped, keeping what was done", () => {
    const runner = activeRunner();
    feed(runner, cycles({ rest: 10, peak: 120, cycles: 2, startTs: FRAME_MS }));

    runner.skip(7000);

    expect(runner.state).toBe("SKIPPED");
    const result = runner.getResult();
    expect(result?.skipped).toBe(true);
    expect(result?.fullReps).toBe(2);
    expect(result?.activeTimeMs).toBe(7000);
  });

  it("can be skipped before starting, with an empty result", () => {
    const runner = new ExerciseRunner(FLEXION, "standard");

    runner.skip(500);

    const result = runner.getResult();
    expect(result?.skipped).toBe(true);
    expect(result?.bestPeak).toBeNull();
    expect(result?.meanDurationMs).toBeNull();
    expect(result?.activeTimeMs).toBe(0);
    expect(result?.measureSource).toBeNull();
  });

  it("cannot be skipped once done", () => {
    const runner = activeRunner();
    feed(runner, cycles({ rest: 10, peak: 120, cycles: 11, startTs: FRAME_MS }));

    runner.skip(99999);

    expect(runner.state).toBe("DONE");
  });
});

describe("ExerciseRunner pausing", () => {
  it("pauses after 500 ms of lost tracking, and resumes by itself", () => {
    const runner = activeRunner();

    runner.update({ timestamp: 500, value: null });
    expect(runner.state).toBe("ACTIVE");
    runner.update({ timestamp: 501, value: null });
    expect(runner.state).toBe("PAUSED");

    runner.update({ timestamp: 2501, value: 10 });
    runner.update({ timestamp: 3500, value: 10 });
    expect(runner.state).toBe("PAUSED");
    runner.update({ timestamp: 3501, value: 10 });
    expect(runner.state).toBe("ACTIVE");
    expect(runner.fullReps).toBe(0);
  });

  it("restarts the one-second wait if tracking drops again", () => {
    const runner = activeRunner();
    runner.update({ timestamp: 501, value: null });

    runner.update({ timestamp: 1000, value: 10 });
    runner.update({ timestamp: 1900, value: null });
    runner.update({ timestamp: 2000, value: 10 });
    runner.update({ timestamp: 2900, value: 10 });
    expect(runner.state).toBe("PAUSED");

    runner.update({ timestamp: 3000, value: 10 });
    expect(runner.state).toBe("ACTIVE");
  });

  it("tells a tracking pause from a patient's own", () => {
    const runner = activeRunner();
    runner.update({ timestamp: 501, value: null });
    expect(runner.pausedByUser).toBe(false);

    runner.update({ timestamp: 600, value: 10 });
    runner.update({ timestamp: 1600, value: 10 });
    runner.pause(1700);
    expect(runner.pausedByUser).toBe(true);
    runner.resume(1800);
    expect(runner.pausedByUser).toBe(false);
  });

  it("does not complete a rep across a tracking loss", () => {
    const runner = activeRunner();
    // Up to the peak, then tracking is lost, and it comes back with the arm down.
    feed(runner, cycles({ rest: 10, peak: 120, cycles: 0.5, startTs: FRAME_MS }));
    const lastSeen = 1500 + FRAME_MS;
    runner.update({ timestamp: lastSeen + 600, value: null });
    expect(runner.state).toBe("PAUSED");
    runner.update({ timestamp: lastSeen + 2000, value: 10 });
    runner.update({ timestamp: lastSeen + 3000, value: 10 });

    expect(runner.state).toBe("ACTIVE");
    expect(runner.fullReps).toBe(0);
    expect(runner.partialReps).toBe(0);
  });

  it("keeps a user's pause until they resume, even with tracking", () => {
    const runner = activeRunner();

    runner.pause(1000);
    runner.update({ timestamp: 1100, value: 10 });
    expect(runner.state).toBe("PAUSED");

    runner.resume(3000);
    expect(runner.state).toBe("ACTIVE");
  });

  it("does not count paused time as active time", () => {
    const runner = activeRunner();
    runner.pause(1000);
    runner.resume(61000);

    // 61 seconds later, but only 1 second was active, so the 90-second limit is far off.
    runner.update({ timestamp: 62000, value: 10 });
    expect(runner.state).toBe("ACTIVE");

    runner.skip(63000);
    const result = runner.getResult();
    expect(result?.pausedTimeMs).toBe(60000);
    expect(result?.activeTimeMs).toBe(3000);
  });

  it("counts a pause still open at the end", () => {
    const runner = activeRunner();
    runner.pause(1000);

    runner.skip(4000);

    const result = runner.getResult();
    expect(result?.pausedTimeMs).toBe(3000);
    expect(result?.activeTimeMs).toBe(1000);
  });

  it("does not let time run out while paused", () => {
    const runner = activeRunner();
    runner.pause(1000);

    runner.update({ timestamp: 200000, value: null });

    expect(runner.state).toBe("PAUSED");
  });

  it("counts normally after a pause", () => {
    const runner = activeRunner();
    runner.pause(100);
    runner.resume(200);

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 2, startTs: 300 }));

    expect(runner.fullReps).toBe(2);
  });
});

describe("ExerciseRunner waiting for rest", () => {
  it("reports when the arm has not yet been at rest, until it is", () => {
    const runner = new ExerciseRunner(FLEXION, "standard");
    runner.startCountdown(-COUNTDOWN_MS);
    runner.update({ timestamp: 0, value: 70 });
    expect(runner.awaitingRest).toBe(true);

    runner.update({ timestamp: 33, value: 10 });
    expect(runner.awaitingRest).toBe(false);
  });
});

describe("ExerciseRunner results", () => {
  it("contain correct peaks, durations and settings", () => {
    const runner = activeRunner();
    feed(runner, cycles({ rest: 10, peak: 100, cycles: 1, startTs: FRAME_MS }));
    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, startTs: 3100 }));

    runner.skip(6200);

    const result = runner.getResult();
    expect(result?.exerciseId).toBe("shoulder_flexion");
    expect(result?.preset).toBe("standard");
    expect(result?.thresholds).toEqual({ low: 30, high: 90 });
    expect(result?.reps).toHaveLength(2);
    expect(result?.fullReps).toBe(2);
    expect(result?.partialReps).toBe(0);
    expect(result?.bestPeak).toBeCloseTo(120, 0);
    const durations = result?.reps.map((rep) => rep.durationMs) ?? [];
    expect(result?.meanDurationMs).toBeCloseTo((durations[0] + durations[1]) / 2);
    expect(durations[0]).toBeGreaterThan(1500);
    expect(durations[0]).toBeLessThan(3000);
  });

  it("use the smallest value as the best peak for the elbow", () => {
    const runner = activeRunner(EXERCISES.elbow_flexion);
    runner.update({ timestamp: FRAME_MS, value: 170 });
    feed(runner, cycles({ rest: 170, peak: 60, cycles: 1, startTs: 2 * FRAME_MS }));
    feed(runner, cycles({ rest: 170, peak: 40, cycles: 1, startTs: 3100 }));

    runner.skip(6200);

    expect(runner.getResult()?.bestPeak).toBeCloseTo(40, 0);
    expect(runner.getResult()?.fullReps).toBe(2);
  });

  it("use the gentle thresholds when chosen", () => {
    const runner = activeRunner(FLEXION, "gentle");

    feed(runner, cycles({ rest: 10, peak: 70, cycles: 1, startTs: FRAME_MS }));
    runner.skip(4000);

    expect(runner.getResult()?.thresholds).toEqual({ low: 30, high: 60 });
    expect(runner.getResult()?.fullReps).toBe(1);
  });

  it("leave partial reps out of the mean duration", () => {
    const runner = activeRunner();
    feed(runner, cycles({ rest: 10, peak: 75, cycles: 1, startTs: FRAME_MS }));

    runner.skip(4000);

    const result = runner.getResult();
    expect(result?.partialReps).toBe(1);
    expect(result?.fullReps).toBe(0);
    expect(result?.meanDurationMs).toBeNull();
    expect(result?.bestPeak).toBeCloseTo(75, 0);
  });

  it("report what most frames used", () => {
    const runner = activeRunner();
    feed(runner, hold(10, 300, FRAME_MS), { source: "2d", trunkReference: "hip" });
    feed(runner, hold(10, 1000, 400), { source: "3d", trunkReference: "vertical" });

    runner.skip(2000);

    expect(runner.getResult()?.measureSource).toBe("3d");
    expect(runner.getResult()?.trunkReference).toBe("vertical");
  });
});

describe("ExerciseRunner plane feedback", () => {
  it("says forward when a flexion rep is mostly out of plane, still counting it", () => {
    const runner = activeRunner();
    const list = events(runner);

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, startTs: FRAME_MS }), { planeDeg: 0 });

    expect(feedbackOf(list)).toContain("forward");
    expect(runner.fullReps).toBe(1);
  });

  it("stays quiet when flexion is in plane", () => {
    const runner = activeRunner();
    const list = events(runner);

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, startTs: FRAME_MS }), { planeDeg: 90 });

    expect(feedbackOf(list)).toEqual(["good"]);
  });

  it("says sideways for abduction out of plane", () => {
    const runner = activeRunner(EXERCISES.shoulder_abduction);
    const list = events(runner);

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, startTs: FRAME_MS }), { planeDeg: 90 });

    expect(feedbackOf(list)).toContain("sideways");
  });

  it("stays quiet with no plane information", () => {
    const runner = activeRunner();
    const list = events(runner);

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, startTs: FRAME_MS }), { planeDeg: null });

    expect(feedbackOf(list)).toEqual(["good"]);
  });

  it("judges each rep separately", () => {
    const runner = activeRunner();
    const list = events(runner);

    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, startTs: FRAME_MS }), { planeDeg: 0 });
    feed(runner, cycles({ rest: 10, peak: 120, cycles: 1, startTs: 3100 }), { planeDeg: 90 });

    // The first rep gets both messages, and the second only "good".
    expect(feedbackOf(list)).toEqual(["forward", "good", "good"]);
  });

  it("does not apply to an exercise with no preferred plane", () => {
    const runner = activeRunner(EXERCISES.elbow_flexion);
    const list = events(runner);
    runner.update({ timestamp: FRAME_MS, value: 170 });

    feed(runner, cycles({ rest: 170, peak: 40, cycles: 1, startTs: 2 * FRAME_MS }), {
      planeDeg: 0,
    });

    expect(feedbackOf(list)).toEqual(["good"]);
  });
});
