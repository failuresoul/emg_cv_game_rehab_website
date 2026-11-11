import { describe, expect, it } from "vitest";

import type { ProgressPoint } from "@/types/api";

import { handProgress, movementQualityProgress } from "./handProgress";

const point = (date: string, changes: Partial<ProgressPoint> = {}): ProgressPoint => ({
  session_id: 1,
  date,
  hull_area_sw2: null,
  warmup_goals_reached: 0,
  warmup_total: 0,
  game_success_rate: null,
  total_reps: 0,
  ...changes,
});

describe("handProgress", () => {
  it("gives one point per session that played each game, as percentages", () => {
    const result = handProgress(
      [
        point("2026-11-01", { bloom_peak_openness: 0.614, piano_hit_rate: 0.5 }),
        point("2026-11-03"),
        point("2026-11-05", { bloom_peak_openness: 0.72 }),
        point("2026-11-07", { piano_hit_rate: 0.875 }),
      ],
      (iso) => iso.slice(5),
    );
    expect(result.openness).toEqual([
      { label: "11-01", value: 61 },
      { label: "11-05", value: 72 },
    ]);
    expect(result.hitRate).toEqual([
      { label: "11-01", value: 50 },
      { label: "11-07", value: 88 },
    ]);
  });

  it("is empty without hand games", () => {
    expect(handProgress([point("2026-11-01")], String)).toEqual({
      openness: [],
      hitRate: [],
      steadiness: [],
      relaxation: [],
    });
  });

  it("gives Grip and hold's wobble in percentage points and its time to relax in seconds", () => {
    const result = handProgress(
      [
        point("2026-11-01", { grip_steadiness: 0.0437, grip_relaxation_ms: 1260 }),
        point("2026-11-03", { grip_steadiness: 0.031, grip_relaxation_ms: null }),
      ],
      (iso) => iso.slice(5),
    );
    expect(result.steadiness).toEqual([
      { label: "11-01", value: 4.4 },
      { label: "11-03", value: 3.1 },
    ]);
    expect(result.relaxation).toEqual([{ label: "11-01", value: 1.3 }]);
  });
});

describe("movementQualityProgress", () => {
  it("gives Path trace's smoothness and Paint the wall's elbow range per session", () => {
    const result = movementQualityProgress(
      [
        point("2026-11-01", { path_sparc: -2.1234, elbow_range_deg: 58.6 }),
        point("2026-11-03"),
        point("2026-11-05", { path_sparc: -1.756 }),
      ],
      (iso) => iso.slice(5),
    );
    expect(result.sparc).toEqual([
      { label: "11-01", value: -2.12 },
      { label: "11-05", value: -1.76 },
    ]);
    expect(result.elbowRange).toEqual([{ label: "11-01", value: 59 }]);
    expect(result.transport).toEqual([]);
  });

  it("gives Pick and place's carry time per session in seconds", () => {
    const result = movementQualityProgress(
      [point("2026-11-01", { pick_transport_ms: 2349 }), point("2026-11-02")],
      (iso) => iso.slice(5),
    );
    expect(result.transport).toEqual([{ label: "11-01", value: 2.3 }]);
  });
});
