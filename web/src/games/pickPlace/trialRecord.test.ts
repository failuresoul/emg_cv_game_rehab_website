import { describe, expect, it } from "vitest";

import type { TrajectoryPoint } from "@/types/api";

import type { CarryMoments } from "./carryMachine";
import {
  buildCarryRecord,
  type CarryRecordInput,
  carryScore,
  DROP_COST,
  SUCCESS_POINTS,
  transportMetrics,
} from "./trialRecord";

const PICK = { x: 0.2, y: 0.8 };
const PLACE = { x: 1.0, y: 0.4 };

/** A minimum-jerk move from `from` to `to` over [t0, t1], at 30 Hz, times relative to spawn. */
function smoothMove(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t0: number,
  t1: number,
): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1000 / 30) {
    const s = (t - t0) / (t1 - t0);
    const share = 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5;
    points.push([t, from.x + (to.x - from.x) * share, from.y + (to.y - from.y) * share]);
  }
  return points;
}

const MOMENTS: CarryMoments = {
  spawn: 1000,
  reached: 2200,
  firstGrasp: 2700,
  lastGrasp: 2700,
  placed: 4700,
  end: 4700,
};

function input(changes: Partial<CarryRecordInput> = {}): CarryRecordInput {
  return {
    trialNo: 3,
    params: { object_radius_sw: 0.35, carry_direction: 0 },
    pick: PICK,
    place: PLACE,
    objectRadiusSw: 0.35,
    boxSizeSw: 0.7,
    outcome: "success",
    moments: MOMENTS,
    drops: 0,
    releaseRawSw: { x: 1.03, y: 0.36 },
    compensation: { flagged: false, type: null, max_values: {} },
    trajectory: [
      ...smoothMove({ x: 0, y: 0 }, PICK, 0, 1200),
      // Held still on the object, then carried straight to the box.
      ...smoothMove(PICK, PICK, 1233, 1700).slice(1),
      ...smoothMove(PICK, { x: 1.03, y: 0.36 }, 1700, 3700).slice(1),
    ],
    ...changes,
  };
}

describe("transportMetrics", () => {
  it("is fully efficient and smooth for a straight minimum-jerk carry", () => {
    const metrics = transportMetrics(smoothMove(PICK, PLACE, 0, 2000), 0, 2000);
    expect(metrics.pathEfficiency).toBeCloseTo(1, 5);
    expect(metrics.sparc).not.toBeNull();
    expect(metrics.sparc as number).toBeLessThan(0);
    expect(metrics.sparc as number).toBeGreaterThan(-2);
    // A minimum-jerk peak is 1.875 times the mean speed.
    const mean = Math.hypot(PLACE.x - PICK.x, PLACE.y - PICK.y) / 2;
    expect(metrics.peakSpeedSwS as number).toBeCloseTo(1.875 * mean, 1);
  });

  it("is less efficient and less smooth for a detour with a stop", () => {
    const corner = { x: 0.2, y: 0.2 };
    const detour = [
      ...smoothMove(PICK, corner, 0, 1000),
      ...smoothMove(corner, PLACE, 1000, 2000).slice(1),
    ];
    const straight = transportMetrics(smoothMove(PICK, PLACE, 0, 2000), 0, 2000);
    const bent = transportMetrics(detour, 0, 2000);
    expect(bent.pathEfficiency as number).toBeLessThan(0.8);
    expect(bent.sparc as number).toBeLessThan(straight.sparc as number);
  });

  it("uses only the carry's time and needs two points", () => {
    const full = smoothMove(PICK, PLACE, 0, 2000);
    expect(transportMetrics(full, 5000, 6000)).toEqual({
      pathEfficiency: null,
      sparc: null,
      peakSpeedSwS: null,
    });
  });
});

describe("buildCarryRecord", () => {
  it("records the target, the timings and the RAW measures of a placed object", () => {
    const record = buildCarryRecord(input());
    expect(record.trial_no).toBe(3);
    expect(record.outcome).toBe("success");
    expect(record.target).toEqual({
      kind: "pick_place",
      pick: [0.2, 0.8],
      place: [1, 0.4],
      object_radius_sw: 0.35,
      box_size_sw: 0.7,
    });
    expect(record.timings).toMatchObject({ spawn: 0, enter: 1200, dwell_done: 1700, end: 3700 });
    expect(record.metrics).toMatchObject({
      reach_ms: 1200,
      grasp_latency_ms: 500,
      transport_ms: 2000,
      drops: 0,
      movement_ms: null,
    });
    expect(record.metrics.transport_path_efficiency).toBeCloseTo(1, 3);
    expect(record.metrics.release_error_sw).toBeCloseTo(Math.hypot(0.03, 0.04), 4);
    expect(record.metrics.sparc as number).toBeLessThan(0);
    expect(record.metrics.peak_speed_sw_s as number).toBeGreaterThan(0);
  });

  it("times the carry from the last grasp after a drop", () => {
    const moments = { ...MOMENTS, lastGrasp: 3500, placed: 4700 };
    const record = buildCarryRecord(input({ moments, drops: 2 }));
    expect(record.metrics.grasp_latency_ms).toBe(500);
    expect(record.metrics.transport_ms).toBe(1200);
    expect(record.metrics.drops).toBe(2);
  });

  it("leaves the carry measures empty for a miss", () => {
    const moments: CarryMoments = { ...MOMENTS, lastGrasp: null, firstGrasp: null, placed: null };
    const record = buildCarryRecord(input({ outcome: "miss", moments, releaseRawSw: null }));
    expect(record.outcome).toBe("miss");
    expect(record.metrics).toMatchObject({
      reach_ms: 1200,
      grasp_latency_ms: null,
      transport_ms: null,
      transport_path_efficiency: null,
      release_error_sw: null,
      sparc: null,
      peak_speed_sw_s: null,
      drops: 0,
    });
  });

  it("saves −0 as 0", () => {
    const record = buildCarryRecord(input({ pick: { x: -0.00001, y: 0.5 } }));
    expect(Object.is(record.target?.pick?.[0], 0)).toBe(true);
  });
});

describe("carryScore", () => {
  it("gives more for a quicker carry and less for drops, never below a success's points", () => {
    expect(carryScore("success", MOMENTS, 0, 15000)).toBe(
      SUCCESS_POINTS + Math.round(50 * (1 - 3700 / 15000)),
    );
    const quick = carryScore("success", MOMENTS, 0, 15000);
    expect(carryScore("success", MOMENTS, 1, 15000)).toBe(quick - DROP_COST);
    expect(carryScore("success", MOMENTS, 9, 15000)).toBe(SUCCESS_POINTS);
    expect(carryScore("miss", MOMENTS, 0, 15000)).toBe(0);
  });
});
