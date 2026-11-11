import { describe, expect, it } from "vitest";

import { exportGameSpecs } from "@/games/shared/gameSpecs";
import type { AdminGameSetting, GameParamSpec, GameSpec } from "@/types/api";

import {
  draftFrom,
  formatValue,
  isAdjustable,
  isCustomised,
  isDirty,
  parseTrials,
  snapToStep,
  toUpdate,
} from "./gameSettingsForm";

const GRIP_SPEC = exportGameSpecs().games.find((game) => game.id === "grip_hold") as GameSpec;
const param = (name: string) =>
  GRIP_SPEC.params.find((spec) => spec.name === name) as GameParamSpec;

function game(changes: Partial<AdminGameSetting> = {}): AdminGameSetting {
  return {
    spec: GRIP_SPEC,
    enabled: true,
    default_params: {},
    trials_default: null,
    notes: null,
    updated_at: null,
    effective_params: Object.fromEntries(GRIP_SPEC.params.map((spec) => [spec.name, spec.default])),
    effective_trials: GRIP_SPEC.trials_default,
    ...changes,
  };
}

describe("isAdjustable", () => {
  it("allows settings with a range that are a difficulty", () => {
    expect(isAdjustable(param("band_width"))).toBe(true);
    expect(isAdjustable(param("rest_ms"))).toBe(false); // Fixed.
    const pickPlace = exportGameSpecs().games.find((item) => item.id === "pick_place");
    const direction = pickPlace?.params.find((spec) => spec.name === "carry_direction");
    expect(direction && isAdjustable(direction)).toBe(false); // Chosen each turn.
  });
});

describe("snapToStep", () => {
  it("keeps values on the step and inside the range", () => {
    expect(snapToStep(param("band_width"), 0.2249)).toBe(0.2);
    expect(snapToStep(param("band_width"), 0.23)).toBe(0.25);
    expect(snapToStep(param("band_width"), 0.9)).toBe(0.35);
    expect(snapToStep(param("band_width"), 0)).toBe(0.1);
    expect(snapToStep(param("hold_ms"), 3260)).toBe(3500);
  });
});

describe("parseTrials", () => {
  it("accepts whole numbers from 5 to 40", () => {
    expect(parseTrials(" 12 ")).toBe(12);
    expect(parseTrials("5")).toBe(5);
    expect(parseTrials("40")).toBe(40);
    for (const text of ["4", "41", "8.5", "", "ten", "-6"]) expect(parseTrials(text)).toBeNull();
  });
});

describe("toUpdate", () => {
  it("sends only the defaults and turns that differ from the game's own", () => {
    const draft = draftFrom(game());
    draft.params.band_width = 0.2;
    draft.params.rest_ms = 9999; // Not adjustable: never sent.
    draft.notes = "  Short holds first.  ";
    expect(toUpdate(game(), draft)).toEqual({
      enabled: true,
      default_params: { band_width: 0.2 },
      trials_default: null,
      notes: "Short holds first.",
    });
    draft.trials = "12";
    draft.enabled = false;
    expect(toUpdate(game(), draft)).toMatchObject({ enabled: false, trials_default: 12 });
  });

  it("is null while the turns are not valid", () => {
    expect(toUpdate(game(), { ...draftFrom(game()), trials: "3" })).toBeNull();
  });
});

describe("isDirty and isCustomised", () => {
  it("notices a change from what is saved", () => {
    const saved = game({
      default_params: { hold_ms: 5000 },
      effective_params: {
        ...game().effective_params,
        hold_ms: 5000,
      },
    });
    const draft = draftFrom(saved);
    expect(isDirty(saved, draft)).toBe(false);
    expect(isDirty(saved, { ...draft, params: { ...draft.params, hold_ms: 6000 } })).toBe(true);
    expect(isDirty(saved, { ...draft, trials: "x" })).toBe(true);
    expect(isCustomised(saved)).toBe(true);
    expect(isCustomised(game())).toBe(false);
    expect(isCustomised(game({ enabled: false }))).toBe(true);
  });
});

describe("formatValue", () => {
  it("shows times in seconds, shares as percentages and other units as they are", () => {
    expect(formatValue(param("hold_ms"), 3000)).toEqual({
      key: "adminGames.unit.seconds",
      params: { value: 3 },
    });
    expect(formatValue(param("band_center"), 0.55)).toEqual({
      key: "adminGames.unit.level",
      params: { value: 0.55 },
    });
    const share = { ...param("band_center"), unit: "share" };
    expect(formatValue(share, 0.6)).toEqual({
      key: "adminGames.unit.percent",
      params: { value: 60 },
    });
  });
});
