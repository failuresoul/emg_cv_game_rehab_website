import { describe, expect, it } from "vitest";

import type { SessionPlan } from "@/types/api";

import { joinWords, nextFocusWords } from "./NextFocus";
import { changedFromPlan, directionWords, movementWords, planRows, reasonText } from "./plan";

const plan: SessionPlan = {
  games: [
    { game_id: "grip_hold", trials: 8, minutes: 3.9, reason_key: "favourite", reason_params: {} },
    {
      game_id: "reach_activate",
      trials: 20,
      minutes: 5,
      reason_key: "practise_weak_direction",
      reason_params: { direction_deg: 90 },
    },
    {
      game_id: "bloom",
      trials: 15,
      minutes: 4,
      reason_key: "focus_hand_opening",
      reason_params: {},
    },
  ],
  total_minutes: 12.9,
  focus: { movements: ["hand_opening"], directions: [90] },
  notes: [],
  version: 1,
  created_at: null,
};

describe("reasonText", () => {
  it("says why each game was chosen in plain words, never mentioning AI", () => {
    const keys = [
      ["focus_reach", {}],
      ["focus_shoulder", {}],
      ["focus_elbow", {}],
      ["focus_hand_opening", {}],
      ["focus_fingers", {}],
      ["focus_grip", {}],
      ["focus_smoothness", {}],
      ["practise_weak_direction", { direction_deg: 135 }],
      ["variety", {}],
      ["favourite", {}],
      ["lighter_today", {}],
      ["balance", { movement: "grip" }],
      ["keep_practising", { movement: "reach" }],
    ] as const;
    const texts = keys.map(([key, params]) =>
      reasonText({ reason_key: key, reason_params: params }),
    );
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/\bAI\b|\{|_/);
    }
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[3]).toContain("hand opening");
    expect(texts[7]).toContain("up and across");
    expect(texts[11]).toContain("gripping");
  });

  it("falls back gently for unknown reasons", () => {
    expect(reasonText({ reason_key: "something_new", reason_params: {} })).toMatch(/practice/);
  });
});

describe("words", () => {
  it("names movements and directions", () => {
    expect(movementWords("hand_opening")).toBe("opening your hand");
    expect(directionWords(90)).toBe("up");
    expect(directionWords(-45)).toBe("down and out");
  });

  it("joins lists", () => {
    expect(joinWords([])).toBe("");
    expect(joinWords(["a"])).toBe("a");
    expect(joinWords(["a", "b", "c"])).toBe("a, b and c");
  });

  it("describes the next session's focus, or what its games train", () => {
    expect(
      nextFocusWords({ focus_movements: ["grip"], focus_directions: [90], planned_games: [] }),
    ).toEqual(["gripping and holding", "reaching up"]);
    const games = nextFocusWords({
      focus_movements: [],
      focus_directions: [],
      planned_games: ["bloom", "reach_activate"],
    });
    expect(games).toHaveLength(2);
  });
});

describe("plan rows", () => {
  it("ticks the plan's games in order, then lists the other available games", () => {
    const rows = planRows(plan, ["reach_activate", "bloom", "fruit_catch", "grip_hold"]);
    expect(rows).toEqual([
      { id: "grip_hold", selected: true },
      { id: "reach_activate", selected: true },
      { id: "bloom", selected: true },
      { id: "fruit_catch", selected: false },
    ]);
    // A planned game the admin has since turned off is left out.
    expect(planRows(plan, ["reach_activate", "bloom"]).map((row) => row.id)).toEqual([
      "reach_activate",
      "bloom",
    ]);
  });

  it("notices when the patient changed the plan", () => {
    const rows = planRows(plan, ["reach_activate", "bloom", "fruit_catch", "grip_hold"]);
    expect(changedFromPlan(rows, plan)).toBe(false);
    expect(changedFromPlan([rows[1], rows[0], rows[2], rows[3]], plan)).toBe(true);
    expect(
      changedFromPlan(
        rows.map((row) => ({ ...row, selected: row.id !== "bloom" })),
        plan,
      ),
    ).toBe(true);
    expect(changedFromPlan(rows, undefined)).toBe(false);
  });
});
