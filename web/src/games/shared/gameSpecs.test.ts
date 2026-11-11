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
