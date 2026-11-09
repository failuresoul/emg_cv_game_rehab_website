import { describe, expect, it } from "vitest";

import { MAX_TRAJECTORY_POINTS, TrajectoryRecorder } from "./trajectoryRecorder";

const at = (x: number, y = 0) => ({ x, y });

describe("TrajectoryRecorder", () => {
  it("stores times relative to spawn, with x and y in shoulder widths", () => {
    const recorder = new TrajectoryRecorder();
    recorder.start(5000);
    recorder.add(5000, at(0.1, 0.2));
    recorder.add(5033.3, at(0.123456789, -0.5));
    expect(recorder.toArray()).toEqual([
      [0, 0.1, 0.2],
      [33.3, 0.1235, -0.5],
    ]);
  });

  it("keeps every frame of a 30 fps camera, even with jitter", () => {
    const recorder = new TrajectoryRecorder();
    recorder.start(0);
    const times = [0, 30, 66, 98, 133, 160, 200];
    times.forEach((time) => recorder.add(time, at(time / 1000)));
    expect(recorder.length).toBe(times.length);
  });

  it("keeps about 30 points a second from a 60 fps camera", () => {
    const recorder = new TrajectoryRecorder();
    recorder.start(0);
    for (let frame = 0; frame < 60; frame++) recorder.add((frame * 1000) / 60, at(frame));
    expect(recorder.length).toBe(30);
  });

  it("skips frames without a fingertip", () => {
    const recorder = new TrajectoryRecorder();
    recorder.start(0);
    expect(recorder.add(0, null)).toBe(false);
    expect(recorder.add(40, at(Number.NaN))).toBe(false);
    expect(recorder.add(80, at(1))).toBe(true);
    expect(recorder.length).toBe(1);
  });

  it("stops at 2000 points and says it was cut short", () => {
    const recorder = new TrajectoryRecorder();
    recorder.start(0);
    for (let frame = 0; frame < 2500; frame++) recorder.add(frame * 34, at(frame));
    expect(recorder.length).toBe(MAX_TRAJECTORY_POINTS);
    expect(recorder.truncated).toBe(true);
    // The first 2000 points are kept, not the last.
    expect(recorder.toArray().at(-1)?.[1]).toBe(1999);
  });

  it("honours a smaller cap", () => {
    const recorder = new TrajectoryRecorder(3);
    recorder.start(0);
    for (let frame = 0; frame < 10; frame++) recorder.add(frame * 40, at(frame));
    expect(recorder.length).toBe(3);
  });

  it("starts empty for each new trial", () => {
    const recorder = new TrajectoryRecorder(2);
    recorder.start(0);
    [0, 40, 80].forEach((time) => recorder.add(time, at(1)));
    expect(recorder.truncated).toBe(true);
    recorder.start(1000);
    expect(recorder.length).toBe(0);
    expect(recorder.truncated).toBe(false);
    recorder.add(1010, at(2));
    expect(recorder.toArray()).toEqual([[10, 2, 0]]);
  });

  it("returns a copy that later recording does not change", () => {
    const recorder = new TrajectoryRecorder();
    recorder.start(0);
    recorder.add(0, at(1));
    const copy = recorder.toArray();
    copy[0][1] = 99;
    recorder.add(40, at(2));
    expect(copy).toHaveLength(1);
    expect(recorder.toArray()[0][1]).toBe(1);
  });
});
