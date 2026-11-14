import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import type { EngineMode, GameId, ProgrammeFields, ProgrammeUpdate } from "@/types/api";
import { EXERCISE_ORDER, EXERCISES, type ExerciseId } from "@/warmup/exercises";

/** The server's limits (server/app/schemas/programme.py). */
export const LIMITS = {
  games: { min: 2, max: 6 },
  minutes: { min: 10, max: 40 },
  rest: { min: 3, max: 10 },
  weeklyGoal: { min: 1, max: 14 },
  level: { min: 1, max: 10 },
  notes: 2000,
  reason: 500,
} as const;

/** The fields in the order the form and the history show them. */
export const FIELD_ORDER: readonly (keyof ProgrammeFields)[] = [
  "enabled_games",
  "max_level",
  "session_minutes_target",
  "games_per_session",
  "rest_every_minutes",
  "warmup_exercises",
  "warmup_preset",
  "engine_mode",
  "emg_default_site",
  "weekly_goal",
  "notes",
];

export const FIELD_LABEL_KEYS: Record<keyof ProgrammeFields, TranslationKey> = {
  enabled_games: "programme.field.enabled_games",
  max_level: "programme.field.max_level",
  session_minutes_target: "programme.field.session_minutes_target",
  games_per_session: "programme.field.games_per_session",
  rest_every_minutes: "programme.field.rest_every_minutes",
  warmup_exercises: "programme.field.warmup_exercises",
  warmup_preset: "programme.field.warmup_preset",
  engine_mode: "programme.field.engine_mode",
  emg_default_site: "programme.field.emg_default_site",
  weekly_goal: "programme.field.weekly_goal",
  notes: "programme.field.notes",
};

export const ENGINE_LABEL_KEYS: Record<EngineMode, TranslationKey> = {
  L0: "adminLevels.mode.L0",
  L1: "adminLevels.mode.L1",
  L2: "adminLevels.mode.L2",
};

/** What a highest level means for the patient, in four bands. */
export function levelMeaningKey(level: number): TranslationKey {
  if (level >= 10) return "programme.level.noLimit";
  if (level >= 7) return "programme.level.challenging";
  if (level >= 4) return "programme.level.moderate";
  return "programme.level.gentle";
}

export function levelOf(draft: ProgrammeFields, game: GameId): number {
  return draft.max_level[game] ?? LIMITS.level.max;
}

/** A level of 10 is the default, so it is left out. */
export function withLevel(draft: ProgrammeFields, game: GameId, level: number): ProgrammeFields {
  const max_level = { ...draft.max_level };
  if (level >= LIMITS.level.max) delete max_level[game];
  else max_level[game] = Math.max(LIMITS.level.min, Math.round(level));
  return { ...draft, max_level };
}

/** Turns a game on or off, keeping the registry's order. */
export function withGame(draft: ProgrammeFields, game: GameId, on: boolean): ProgrammeFields {
  const chosen = new Set(draft.enabled_games);
  if (on) chosen.add(game);
  else chosen.delete(game);
  return { ...draft, enabled_games: GAME_IDS.filter((id) => chosen.has(id)) };
}

export function withExercise(
  draft: ProgrammeFields,
  exercise: ExerciseId,
  on: boolean,
): ProgrammeFields {
  const chosen = new Set(draft.warmup_exercises);
  if (on) chosen.add(exercise);
  else chosen.delete(exercise);
  return { ...draft, warmup_exercises: EXERCISE_ORDER.filter((id) => chosen.has(id)) };
}

export interface ProgrammeProblem {
  field: keyof ProgrammeFields;
  key: TranslationKey;
  params?: Record<string, number | string>;
}

const within = (value: number, range: { min: number; max: number }) =>
  Number.isInteger(value) && value >= range.min && value <= range.max;

/** The same rules as the server, worded for the admin. Empty when the programme can be saved. */
export function validateProgramme(
  draft: ProgrammeFields,
  libraryDisabled: readonly GameId[] = [],
): ProgrammeProblem[] {
  const problems: ProgrammeProblem[] = [];
  const { min, max } = draft.games_per_session;
  if (!within(min, LIMITS.games) || !within(max, LIMITS.games)) {
    problems.push({
      field: "games_per_session",
      key: "programme.error.gamesRange",
      params: LIMITS.games,
    });
  } else if (min > max) {
    problems.push({ field: "games_per_session", key: "programme.error.gamesOrder" });
  }
  const off = new Set(libraryDisabled);
  const blocked = draft.enabled_games.filter((game) => off.has(game));
  if (blocked.length > 0) {
    problems.push({
      field: "enabled_games",
      key: "programme.error.libraryOff",
      params: { games: blocked.map((game) => t(GAMES[game].nameKey)).join(", ") },
    });
  }
  if (draft.enabled_games.length === 0) {
    problems.push({ field: "enabled_games", key: "programme.error.noGames" });
  } else if (within(min, LIMITS.games) && draft.enabled_games.length < min) {
    problems.push({
      field: "enabled_games",
      key: "programme.error.tooFewGames",
      params: { n: min },
    });
  }
  if (!within(draft.session_minutes_target, LIMITS.minutes)) {
    problems.push({
      field: "session_minutes_target",
      key: "programme.error.minutes",
      params: LIMITS.minutes,
    });
  }
  if (!within(draft.rest_every_minutes, LIMITS.rest)) {
    problems.push({
      field: "rest_every_minutes",
      key: "programme.error.rest",
      params: LIMITS.rest,
    });
  }
  if (draft.warmup_exercises.length === 0) {
    problems.push({ field: "warmup_exercises", key: "programme.error.noExercises" });
  }
  if (!within(draft.weekly_goal, LIMITS.weeklyGoal)) {
    problems.push({
      field: "weekly_goal",
      key: "programme.error.weeklyGoal",
      params: LIMITS.weeklyGoal,
    });
  }
  if (Object.values(draft.max_level).some((level) => !within(level ?? 0, LIMITS.level))) {
    problems.push({ field: "max_level", key: "programme.error.level" });
  }
  if ((draft.notes ?? "").length > LIMITS.notes) {
    problems.push({ field: "notes", key: "programme.error.notes", params: { n: LIMITS.notes } });
  }
  return problems;
}

/** Comparable values, as the server stores them: lists in order, levels of 10 left out, notes
 * trimmed. */
function normalised(fields: ProgrammeFields): ProgrammeFields {
  const levels: Partial<Record<GameId, number>> = {};
  for (const game of GAME_IDS) {
    const level = fields.max_level[game];
    if (level !== undefined && level < LIMITS.level.max) levels[game] = level;
  }
  const notes = (fields.notes ?? "").trim();
  return {
    ...fields,
    enabled_games: GAME_IDS.filter((id) => fields.enabled_games.includes(id)),
    warmup_exercises: EXERCISE_ORDER.filter((id) => fields.warmup_exercises.includes(id)),
    max_level: levels,
    notes: notes === "" ? null : notes,
  };
}

/** The fields that differ, in the form's order. */
export function changedFields(
  before: ProgrammeFields,
  after: ProgrammeFields,
): (keyof ProgrammeFields)[] {
  const a = normalised(before);
  const b = normalised(after);
  return FIELD_ORDER.filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]));
}

/** The PUT body: the whole programme, as stored, and the reason when one was given. */
export function toUpdate(draft: ProgrammeFields, reason: string): ProgrammeUpdate {
  const trimmed = reason.trim();
  return { ...normalised(draft), reason: trimmed === "" ? null : trimmed.slice(0, LIMITS.reason) };
}

/** Just the settings, from a programme read from the server. */
export function fieldsOf(programme: ProgrammeFields): ProgrammeFields {
  return normalised({
    enabled_games: programme.enabled_games,
    max_level: programme.max_level,
    session_minutes_target: programme.session_minutes_target,
    games_per_session: { ...programme.games_per_session },
    warmup_exercises: programme.warmup_exercises,
    warmup_preset: programme.warmup_preset,
    rest_every_minutes: programme.rest_every_minutes,
    engine_mode: programme.engine_mode,
    emg_default_site: programme.emg_default_site,
    weekly_goal: programme.weekly_goal,
    notes: programme.notes,
  });
}

const isGame = (value: unknown): value is GameId =>
  typeof value === "string" && (GAME_IDS as readonly string[]).includes(value);
const isExercise = (value: unknown): value is ExerciseId =>
  typeof value === "string" && (EXERCISE_ORDER as readonly string[]).includes(value);

/** A field's value in words, for the save summary and the history. */
export function formatProgrammeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return t("programme.value.none");
  switch (field) {
    case "enabled_games":
      return Array.isArray(value)
        ? value
            .filter(isGame)
            .map((game) => t(GAMES[game].nameKey))
            .join(", ") || t("programme.value.none")
        : String(value);
    case "warmup_exercises":
      return Array.isArray(value)
        ? value
            .filter(isExercise)
            .map((id) => t(EXERCISES[id].nameKey))
            .join(", ") || t("programme.value.none")
        : String(value);
    case "max_level": {
      if (typeof value !== "object") return String(value);
      const entries = Object.entries(value as Record<string, number>).filter(([game]) =>
        isGame(game),
      );
      if (entries.length === 0) return t("programme.value.noLimits");
      return entries
        .map(([game, level]) =>
          t("programme.value.gameLevel", { game: t(GAMES[game as GameId].nameKey), level }),
        )
        .join(", ");
    }
    case "session_minutes_target":
      return t("programme.value.minutes", { n: Number(value) });
    case "rest_every_minutes":
      return t("programme.value.everyMinutes", { n: Number(value) });
    case "games_per_session": {
      const range = value as { min?: number; max?: number };
      return t("programme.value.gamesRange", { min: range.min ?? "–", max: range.max ?? "–" });
    }
    case "warmup_preset":
      return t(value === "gentle" ? "programme.preset.gentle" : "programme.preset.personal");
    case "engine_mode":
      return value === "L0" || value === "L1" || value === "L2"
        ? t(ENGINE_LABEL_KEYS[value])
        : String(value);
    case "emg_default_site":
      return t(value === "extensors" ? "programme.site.extensors" : "programme.site.flexors");
    case "weekly_goal":
      return t("programme.value.weeklyGoal", { n: Number(value) });
    default:
      return String(value);
  }
}

/** A history row's field name, or the raw name for one this app does not know. */
export function fieldLabel(field: string): string {
  return field in FIELD_LABEL_KEYS ? t(FIELD_LABEL_KEYS[field as keyof ProgrammeFields]) : field;
}
