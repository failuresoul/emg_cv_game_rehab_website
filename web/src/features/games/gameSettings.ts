import { useQuery } from "@tanstack/react-query";

import { GAME_IDS, GAMES } from "@/games/shared/registry";
import type { GameDefinition, ParamSpec } from "@/games/shared/types";
import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import type { GameId, PatientGameSetting } from "@/types/api";

export const GAME_SETTINGS_KEY = "gameSettings";

/**
 * The games the admin lets patients play, with their starting defaults and trials. Settings
 * change rarely, so they are kept for the session. A failed request is not shown as an error:
 * the plan and the games then use the games' own defaults.
 */
export function useGameSettings() {
  return useQuery({
    queryKey: [GAME_SETTINGS_KEY],
    queryFn: async () => (await api.get<PatientGameSetting[]>("/games/settings")).data,
    staleTime: 5 * 60 * 1000,
    meta: SILENT,
  });
}

/**
 * The games to offer, in the registry's order: the enabled ones from the admin's settings, or
 * every built game when the settings could not be loaded.
 */
export function playableGames(settings: readonly PatientGameSetting[] | undefined): GameId[] {
  const built = GAME_IDS.filter((id) => GAMES[id].implemented);
  if (!settings) return built;
  const enabled = new Set(settings.map((setting) => setting.game_id));
  return built.filter((id) => enabled.has(id));
}

/** A setting's default replaced by the admin's, when that value is inside its range. */
function withDefault(spec: ParamSpec, value: number | undefined): ParamSpec {
  if (value === undefined || !Number.isFinite(value)) return spec;
  if (value < spec.min || value > spec.max) return spec;
  return { ...spec, default: value };
}

/**
 * The game as the admin set it up: each setting's default and the number of trials replaced.
 * The provider starts every trial from these defaults; a patient's own value from the warm-up
 * still comes first where a game has one.
 */
export function applyGameSetting(
  definition: GameDefinition,
  setting: PatientGameSetting | undefined,
): GameDefinition {
  if (!setting) return definition;
  const trials = Number.isInteger(setting.trials) && setting.trials > 0 ? setting.trials : null;
  return {
    ...definition,
    params: definition.params.map((spec) => withDefault(spec, setting.params[spec.name])),
    trialsDefault: trials ?? definition.trialsDefault,
  };
}

/** About how long a game takes with this many trials, in whole minutes (at least 1). */
export function estimatedMinutes(definition: GameDefinition, trials: number): number {
  const perTrial = definition.estimatedMinutes / definition.trialsDefault;
  return Math.max(1, Math.round(perTrial * trials));
}

/** The admin's setting for one game, if the settings are loaded and the game is enabled. */
export function settingFor(
  settings: readonly PatientGameSetting[] | undefined,
  gameId: GameId,
): PatientGameSetting | undefined {
  return settings?.find((setting) => setting.game_id === gameId);
}
