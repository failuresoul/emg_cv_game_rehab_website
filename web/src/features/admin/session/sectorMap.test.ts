import { describe, expect, it } from "vitest";

import type { AdaptationLogRow } from "@/types/api";

import { meanColour, parseSector, sectorCells, targetDots } from "./sectorMap";

function log(trialNo: number, changes: Partial<AdaptationLogRow> = {}): AdaptationLogRow {
  return {
    trial_no: trialNo,
    engine: "L2",
    state_before: {},
    state_after: {},
    params: {},
    decision: "",
    safety_override: null,
    cue: null,
    trial: null,
    level: 5,
    created_at: "2026-11-12T10:00:00Z",
    ...changes,
  };
}

describe("parseSector", () => {
  it("reads directions, sides and rings", () => {
    expect(parseSector("D3R2")).toEqual({ directionDeg: 135, ring: 2 });
    expect(parseSector("out-R1")).toEqual({ directionDeg: 0, ring: 1 });
    expect(parseSector("across-R4")).toEqual({ directionDeg: 180, ring: 4 });
    expect(parseSector("D9R2")).toBeNull();
    expect(parseSector("nonsense")).toBeNull();
  });
});

describe("sectorCells", () => {
  it("gives each sector's posterior mean and trials after the run's last decision", () => {
    const extra = {
      sectors: { D0R1: [8, 2], D2R3: [1, 3] },
      seen: { D0R1: 6 },
    };
    const logs = [
      log(1, { state_after: { d: {}, extra } as never }),
      log(0, { state_after: { d: {}, extra: { sectors: { D0R1: [4, 1] } } } as never }),
    ];
    expect(sectorCells(logs)).toEqual([
      { name: "D0R1", directionDeg: 0, ring: 1, mean: 0.8, trials: 6 },
      { name: "D2R3", directionDeg: 90, ring: 3, mean: 0.25, trials: 0 },
    ]);
  });

  it("is empty for engines without sector beliefs", () => {
    expect(sectorCells([log(0, { state_after: { d: { spatial: 0.4 } } })])).toEqual([]);
    expect(sectorCells([])).toEqual([]);
  });
});

describe("targetDots", () => {
  it("lists the chosen targets in trial order", () => {
    const at = (sector: string, deg: number | null, side: "out" | "across" | null = null) => ({
      details: { target: { sector, direction_deg: deg, distance_frac: 0.7, side } },
    });
    const dots = targetDots([
      log(1, at("D4R2", 180)),
      log(0, at("D2R2", 90)),
      log(2, at("out-R2", null, "out")),
    ]);
    expect(dots.map((dot) => [dot.order, dot.directionDeg, dot.sector])).toEqual([
      [1, 90, "D2R2"],
      [2, 180, "D4R2"],
      [3, 0, "out-R2"],
    ]);
    expect(targetDots([log(0)])).toEqual([]);
  });
});

describe("meanColour", () => {
  it("runs from pale to the primary teal", () => {
    expect(meanColour(0)).toBe("rgb(242, 230, 217)");
    expect(meanColour(1)).toBe("rgb(15, 92, 92)");
    expect(meanColour(2)).toBe(meanColour(1));
    expect(meanColour(0.5)).toBe("rgb(140, 194, 187)");
  });
});
