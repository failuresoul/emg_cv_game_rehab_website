import { describe, expect, it } from "vitest";

import { FixedProvider } from "@/ai/paramsProvider";
import { DEFAULT_PLAN, defaultPlanRows } from "@/features/session/gameQueue";
import { GAME_IDS, GAMES } from "@/games/shared/registry";
import type { PatientGameSetting } from "@/types/api";

import { applyGameSetting, estimatedMinutes, playableGames, settingFor } from "./gameSettings";

const GRIP: PatientGameSetting = {
  game_id: "grip_hold",
  params: { band_width: 0.2, hold_ms: 5000, band_center: 0.95, rest_ms: 2000 },
  trials: 12,
};

describe("playableGames", () => {
  it("lists only the games the admin left on, in the registry's order", () => {
    const settings: PatientGameSetting[] = [
      GRIP,
      { game_id: "reach_activate", params: {}, trials: 20 },
    ];
    expect(playableGames(settings)).toEqual(["reach_activate", "grip_hold"]);
  });

  it("offers every built game when the settings could not be loaded", () => {
    expect(playableGames(undefined)).toEqual(GAME_IDS.filter((id) => GAMES[id].implemented));
  });

  it("leaves a turned-off default game out of the plan", () => {
    const available = playableGames(
      GAME_IDS.filter((id) => id !== "bloom").map((id) => ({ game_id: id, params: {}, trials: 8 })),
    );
    const ticked = defaultPlanRows(available).filter((row) => row.selected);
    expect(ticked.map((row) => row.id)).toEqual(DEFAULT_PLAN.filter((id) => id !== "bloom"));
  });
});

describe("applyGameSetting", () => {
  it("uses the admin's defaults inside their ranges and the admin's turns", () => {
    const configured = applyGameSetting(GAMES.grip_hold, GRIP);
    const defaults = Object.fromEntries(configured.params.map((spec) => [spec.name, spec.default]));
    expect(defaults.band_width).toBe(0.2);
    expect(defaults.hold_ms).toBe(5000);
    // Outside its range (0.3–0.8): the game's own default stays.
    expect(defaults.band_center).toBe(0.5);
    expect(configured.trialsDefault).toBe(12);
    // Ranges never change.
    expect(configured.params.map((spec) => [spec.min, spec.max])).toEqual(
      GAMES.grip_hold.params.map((spec) => [spec.min, spec.max]),
    );
    expect(GAMES.grip_hold.trialsDefault).toBe(8);
  });

  it("leaves the game as it is without a setting", () => {
    expect(applyGameSetting(GAMES.bloom, undefined)).toBe(GAMES.bloom);
  });

  it("gives the provider the admin's defaults to start every trial from", () => {
    const configured = applyGameSetting(GAMES.grip_hold, GRIP);
    const provider = new FixedProvider({
      specsFor: (id) => (id === "grip_hold" ? configured.params : GAMES[id].params),
      seed: 1,
    });
    expect(provider.nextParams("grip_hold", [])).toMatchObject({
      band_width: 0.2,
      hold_ms: 5000,
      band_center: 0.5,
    });
  });
});

describe("estimatedMinutes and settingFor", () => {
  it("scales the time with the number of turns", () => {
    expect(estimatedMinutes(GAMES.grip_hold, 8)).toBe(4);
    expect(estimatedMinutes(GAMES.grip_hold, 16)).toBe(8);
    expect(estimatedMinutes(GAMES.grip_hold, 1)).toBe(1);
  });

  it("the default plan takes about 16 minutes", () => {
    const minutes = DEFAULT_PLAN.reduce(
      (total, id) => total + estimatedMinutes(GAMES[id], GAMES[id].trialsDefault),
      0,
    );
    expect(minutes).toBe(16);
  });

  it("finds a game's setting", () => {
    expect(settingFor([GRIP], "grip_hold")).toBe(GRIP);
    expect(settingFor([GRIP], "bloom")).toBeUndefined();
    expect(settingFor(undefined, "bloom")).toBeUndefined();
  });
});
