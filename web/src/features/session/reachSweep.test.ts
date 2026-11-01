import { describe, expect, it } from "vitest";

import { buildCalibration, DIRECTIONS_DEG } from "./calibration";
import { ReachSweep, SWEEP_MS, type SweepFrame } from "./reachSweep";

const FRAME_MS = 33;

function frame(timestamp: number, wristSw: SweepFrame["wristSw"]): SweepFrame {
  return { timestamp, wristSw, trunkSw: { x: 0, y: 0 }, shoulderWidthPx: 160 };
}

const atAngle = (deg: number, radius: number) => ({
  x: radius * Math.cos((deg * Math.PI) / 180),
  y: radius * Math.sin((deg * Math.PI) / 180),
});

/** Moves slowly around a full circle of this radius. */
function circle(sweep: ReachSweep, radius: number, startTs = 0, durationMs = 8000) {
  let last = sweep.add(frame(startTs, atAngle(0, radius)));
  for (let t = FRAME_MS; t <= durationMs; t += FRAME_MS) {
    last = sweep.add(frame(startTs + t, atAngle((t / durationMs) * 360, radius)));
  }
  return last;
}

describe("ReachSweep", () => {
  it("measures every direction from one movement around a circle", () => {
    const sweep = new ReachSweep();

    circle(sweep, 1.2);

    for (const result of sweep.results()) {
      expect(result.bestProjectionSw).toBeCloseTo(1.2, 1);
      expect(result.flagged).toBe(false);
    }
    expect(sweep.litCount).toBe(8);
  });

  it("gives data the server accepts", () => {
    const sweep = new ReachSweep();
    circle(sweep, 1.2);

    const calibration = buildCalibration(sweep.results(), "left");

    expect(calibration?.reach_radii_sw).toHaveLength(8);
    expect(calibration?.directions_deg).toEqual([...DIRECTIONS_DEG]);
    expect(calibration?.quality.valid).toEqual(Array(8).fill(true));
    expect(calibration?.quality.retries).toBe(0);
    expect(calibration?.hull_sw.length).toBeGreaterThanOrEqual(3);
  });

  it("lights only the stars in the direction reached", () => {
    const sweep = new ReachSweep();

    sweep.add(frame(0, atAngle(90, 1)));
    const update = sweep.add(frame(33, atAngle(90, 1)));

    expect(update.newlyLit.sort()).toEqual([1, 2, 3]);
    expect(sweep.litFlags[6]).toBe(false);
  });

  it("lights each star once", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, atAngle(90, 1)));
    sweep.add(frame(33, atAngle(90, 1)));

    expect(sweep.add(frame(66, atAngle(90, 1))).newlyLit).toEqual([]);
  });

  it("does not light a star for a very short reach", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, atAngle(90, 0.3)));

    expect(sweep.add(frame(33, atAngle(90, 0.3))).newlyLit).toEqual([]);
  });

  it("marks directions never reached, without blocking the others", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, atAngle(90, 1)));
    sweep.add(frame(33, atAngle(90, 1)));

    const results = sweep.results();
    const calibration = buildCalibration(results, "left");

    expect(results[6].bestProjectionSw).toBeNull();
    expect(results[6].flagged).toBe(true);
    expect(calibration?.reach_radii_sw[6]).toBe(0.2);
    expect(calibration?.quality.valid[6]).toBe(false);
    expect(calibration?.quality.valid[2]).toBe(true);
  });

  it("ignores a single bad frame", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, atAngle(90, 1)));
    sweep.add(frame(33, atAngle(90, 1)));

    sweep.add(frame(66, atAngle(90, 3)));
    sweep.add(frame(99, atAngle(90, 1)));

    expect(sweep.results()[2].bestProjectionSw).toBeCloseTo(1);
  });

  it("finishes after 20 seconds of seeing the arm", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, atAngle(90, 1)));

    expect(sweep.add(frame(SWEEP_MS - 1, atAngle(90, 1))).isFinished).toBe(false);
    expect(sweep.add(frame(SWEEP_MS, atAngle(90, 1))).isFinished).toBe(true);
  });

  it("finishes 3 seconds after the last star", () => {
    const sweep = new ReachSweep();

    circle(sweep, 1.2);
    const lastStarTime = 8000;
    const update = sweep.add(frame(lastStarTime + 5000, atAngle(0, 1.2)));

    expect(update.isFinished).toBe(true);
  });

  it("stops the clock while the arm is out of view, and says so", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, atAngle(90, 1)));
    sweep.add(frame(1000, atAngle(90, 1)));

    expect(sweep.add(frame(1400, null)).isArmLost).toBe(false);
    const lost = sweep.add(frame(10000, null));

    expect(lost.isArmLost).toBe(true);
    expect(lost.secondsLeft).toBe(19);
    expect(sweep.add(frame(10033, atAngle(90, 1))).isArmLost).toBe(false);
  });

  it("does not join a reach across a gap", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, atAngle(90, 1)));
    sweep.add(frame(33, null));

    expect(sweep.add(frame(66, atAngle(90, 1))).newlyLit).toEqual([]);
  });

  it("gives up after 45 seconds if the arm is never seen", () => {
    const sweep = new ReachSweep();
    sweep.add(frame(0, null));

    expect(sweep.add(frame(44_999, null)).isFinished).toBe(false);
    expect(sweep.add(frame(45_000, null)).isFinished).toBe(true);
    expect(sweep.results().every((result) => result.flagged)).toBe(true);
  });

  it("records the largest trunk movement without stopping", () => {
    const sweep = new ReachSweep();

    sweep.add({ ...frame(0, atAngle(90, 1)), trunkSw: { x: 0.3, y: 0.4 } });
    sweep.add({ ...frame(33, atAngle(90, 1)), trunkSw: { x: 0, y: 0.1 } });

    expect(sweep.results()[0].maxTrunkSw).toBeCloseTo(0.5);
  });
});
