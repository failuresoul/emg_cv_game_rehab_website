import { GAME_IDS, GAMES } from "./registry";
import type { DifficultyComponent } from "./types";

/**
 * The game settings as the server reads them, in shared/game-specs.json: the server checks the
 * admin's defaults against them. `npm run export:specs` writes the file; a test fails when it is
 * out of date with the registry. Names are snake_case for Python.
 */

export interface ExportedParamSpec {
  name: string;
  label_key: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
  harder: "higher" | "lower" | null;
  component: DifficultyComponent;
}

export interface ExportedGameSpec {
  id: string;
  name_key: string;
  description_key: string;
  movement_key: string;
  implemented: boolean;
  trials_default: number;
  estimated_minutes: number;
  params: ExportedParamSpec[];
}

export interface ExportedGameSpecs {
  /** The file is generated: edit the registry and run `npm run export:specs` instead. */
  generated_by: string;
  games: ExportedGameSpec[];
}

export const GAME_SPECS_PATH = "shared/game-specs.json";

export function exportGameSpecs(): ExportedGameSpecs {
  return {
    generated_by: "cd web; npm run export:specs",
    games: GAME_IDS.map((id) => {
      const game = GAMES[id];
      return {
        id,
        name_key: game.nameKey,
        description_key: game.descriptionKey,
        movement_key: game.movementKey,
        implemented: game.implemented,
        trials_default: game.trialsDefault,
        estimated_minutes: game.estimatedMinutes,
        params: game.params.map((spec) => ({
          name: spec.name,
          label_key: spec.labelKey,
          min: spec.min,
          max: spec.max,
          step: spec.step,
          default: spec.default,
          unit: spec.unit,
          harder: spec.harder,
          component: spec.component,
        })),
      };
    }),
  };
}

/** The file's exact text: two-space indents and a final newline. */
export function gameSpecsJson(): string {
  return `${JSON.stringify(exportGameSpecs(), null, 2)}\n`;
}
