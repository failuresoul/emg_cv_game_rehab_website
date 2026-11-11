import { describe, expect, it } from "vitest";

// The file as it is on disk, through Vite, so the test needs no Node types.
import fileText from "../../../../shared/game-specs.json?raw";

import { GAME_SPECS_PATH, exportGameSpecs, gameSpecsJson } from "./gameSpecs";
import { GAME_IDS, GAMES } from "./registry";

describe("shared/game-specs.json", () => {
  it("is up to date with the registry (run `npm run export:specs` if not)", () => {
    expect(GAME_SPECS_PATH).toBe("shared/game-specs.json");
    // Git may check the file out with Windows line endings.
    expect(fileText.replace(/\r\n/g, "\n")).toBe(gameSpecsJson());
  });

  it("lists every game with its settings", () => {
    const { games } = exportGameSpecs();
    expect(games.map((game) => game.id)).toEqual(GAME_IDS);
    const pickPlace = games.find((game) => game.id === "pick_place");
    expect(pickPlace?.trials_default).toBe(GAMES.pick_place.trialsDefault);
    expect(pickPlace?.params.find((spec) => spec.name === "box_size_sw")).toEqual({
      name: "box_size_sw",
      label_key: "param.boxSizeSw",
      min: 0.4,
      max: 0.9,
      step: 0.05,
      default: 0.7,
      unit: "sw",
      harder: "lower",
      component: "precision",
    });
  });

  it("has every default inside its range", () => {
    for (const game of exportGameSpecs().games) {
      for (const spec of game.params) {
        expect(spec.min).toBeLessThanOrEqual(spec.default);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    }
  });
});

describe("difficulty components", () => {
  const byName = (gameId: string) =>
    Object.fromEntries(
      (exportGameSpecs().games.find((game) => game.id === gameId)?.params ?? []).map((spec) => [
        spec.name,
        spec.component,
      ]),
    );

  it("never adapts a single-value setting or one that is not a difficulty", () => {
    for (const game of exportGameSpecs().games) {
      for (const spec of game.params) {
        if (spec.min === spec.max || spec.harder === null) {
          expect(spec.component, `${game.id}.${spec.name}`).toBe("fixed");
        }
      }
    }
  });

  it("gives every game something to adapt", () => {
    for (const game of exportGameSpecs().games) {
      expect(
        game.params.some((spec) => spec.component !== "fixed"),
        game.id,
      ).toBe(true);
    }
  });

  it("assigns each game's settings to the agreed components", () => {
    expect(byName("reach_activate")).toMatchObject({
      distance_frac: "spatial",
      target_radius_sw: "precision",
      dwell_ms: "precision",
      activation_demand: "activation",
      activation_window_ms: "activation",
      rest_ms: "fixed",
    });
    expect(byName("balloon_pop")).toMatchObject({
      height_frac: "spatial",
      balloon_radius_sw: "precision",
      hover_ms: "speed",
    });
    expect(byName("fruit_catch")).toMatchObject({
      spread_frac: "spatial",
      fall_speed_sw_s: "speed",
      basket_width_sw: "precision",
      spawn_interval_ms: "speed",
    });
    expect(byName("bloom")).toMatchObject({
      open_demand: "activation",
      open_hold_ms: "activation",
      phase_time_limit_ms: "speed",
    });
    expect(byName("finger_piano")).toMatchObject({
      sequence_length: "precision",
      note_interval_ms: "speed",
      hit_window_ms: "speed",
      touch_threshold: "precision",
    });
    expect(byName("path_trace")).toMatchObject({
      path_length_frac: "spatial",
      guide_speed_sw_s: "speed",
      corridor_width_sw: "precision",
    });
    expect(byName("paint_wall")).toMatchObject({
      required_range_frac: "spatial",
      sweeps_needed: "activation",
      time_limit_ms: "speed",
    });
    expect(byName("pick_place")).toMatchObject({
      pick_distance_frac: "spatial",
      place_distance_frac: "spatial",
      object_radius_sw: "precision",
      box_size_sw: "precision",
      carry_angle_deg: "spatial",
      time_limit_ms: "speed",
    });
    expect(byName("grip_hold")).toMatchObject({
      band_center: "activation",
      band_width: "precision",
      hold_ms: "activation",
    });
  });
});
