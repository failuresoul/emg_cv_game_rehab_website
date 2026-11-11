import type { TranslationKey } from "@/i18n";
import type { AdminGameSetting, GameParamSpec, GameSettingUpdate } from "@/types/api";

/** How many turns the admin may set for a game; the server checks the same. */
export const MIN_TRIALS = 5;
export const MAX_TRIALS = 40;

/** What the admin is editing for one game, before saving. */
export interface GameDraft {
  enabled: boolean;
  /** As typed, so a half-typed number can be shown. */
  trials: string;
  /** Every setting's value, starting from the effective ones. */
  params: Record<string, number>;
  notes: string;
}

/**
 * Whether the admin can set a setting's default: it has a range, and it is a difficulty. Settings
 * that are not (such as which direction a target comes from) are chosen by the game each turn.
 */
export function isAdjustable(spec: GameParamSpec): boolean {
  return spec.min < spec.max && spec.harder !== null;
}

/** A value on the setting's step, inside its range, without floating-point dust. */
export function snapToStep(spec: GameParamSpec, value: number): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  if (!(spec.step > 0)) return clamped;
  const steps = Math.round((clamped - spec.min) / spec.step);
  const decimals = Math.max(0, -Math.floor(Math.log10(spec.step)) + 2);
  return Number(Math.min(spec.max, spec.min + steps * spec.step).toFixed(decimals));
}

export function draftFrom(game: AdminGameSetting): GameDraft {
  return {
    enabled: game.enabled,
    trials: String(game.effective_trials),
    params: { ...game.effective_params },
    notes: game.notes ?? "",
  };
}

/** The turns typed, or null unless a whole number from 5 to 40. */
export function parseTrials(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= MIN_TRIALS && value <= MAX_TRIALS ? value : null;
}

/**
 * The setting to save. Only the defaults that differ from the game's own are sent, and the turns
 * only when they differ, so a later change to a game's own default still reaches patients.
 * Null while the turns are not valid.
 */
export function toUpdate(game: AdminGameSetting, draft: GameDraft): GameSettingUpdate | null {
  const trials = parseTrials(draft.trials);
  if (trials === null) return null;
  const defaults: Record<string, number> = {};
  for (const spec of game.spec.params) {
    if (!isAdjustable(spec)) continue;
    const value = draft.params[spec.name];
    if (value === undefined || !Number.isFinite(value)) continue;
    const snapped = snapToStep(spec, value);
    if (snapped !== spec.default) defaults[spec.name] = snapped;
  }
  const notes = draft.notes.trim();
  return {
    enabled: draft.enabled,
    default_params: defaults,
    trials_default: trials === game.spec.trials_default ? null : trials,
    notes: notes === "" ? null : notes,
  };
}

/** True when saving the draft would change what is saved now. */
export function isDirty(game: AdminGameSetting, draft: GameDraft): boolean {
  const update = toUpdate(game, draft);
  if (update === null) return true;
  const saved = toUpdate(game, draftFrom(game));
  return JSON.stringify(update) !== JSON.stringify(saved);
}

/** True when the game has any setting of the admin's: turned off, other defaults or turns. */
export function isCustomised(game: AdminGameSetting): boolean {
  return (
    !game.enabled ||
    Object.keys(game.default_params).length > 0 ||
    game.trials_default !== null ||
    Boolean(game.notes)
  );
}

const UNIT_KEYS: Record<string, TranslationKey> = {
  sw: "adminGames.unit.sw",
  ms: "adminGames.unit.seconds",
  deg: "adminGames.unit.deg",
  level: "adminGames.unit.level",
  share: "adminGames.unit.percent",
  count: "adminGames.unit.count",
  sw_per_s: "adminGames.unit.swPerS",
  bpm: "adminGames.unit.bpm",
  palm_ratio: "adminGames.unit.palm",
};

/** A setting's value in words: seconds for times, a percentage for shares, a unit otherwise. */
export function formatValue(
  spec: GameParamSpec,
  value: number,
): { key: TranslationKey; params: { value: number } } {
  const key = UNIT_KEYS[spec.unit] ?? "adminGames.unit.count";
  if (spec.unit === "ms") return { key, params: { value: Math.round(value / 100) / 10 } };
  if (spec.unit === "share") return { key, params: { value: Math.round(value * 100) } };
  return { key, params: { value: Math.round(value * 100) / 100 } };
}
