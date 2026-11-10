import { describe, expect, it } from "vitest";

import type { ProgressPoint } from "@/types/api";

import { handProgress } from "./handProgress";

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
    expect(handProgress([point("2026-11-01")], String)).toEqual({ openness: [], hitRate: [] });
  });
});
