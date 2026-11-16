/**
 * Every EMG threshold in one place: the sensor check, calibration, smoothing and onsets. The
 * defaults, limits and units are in emgSettings.json (the server checks changes against its own
 * copy, server/app/core/emg_settings.json, which a test keeps identical).
 *
 * `EMG` is one live object: every rule reads it when it runs, so an admin's change on the
 * "EMG settings" panel (stored on the server, loaded by EmgProvider) applies from the next check.
 * Smoothing changes apply from the next START, when the signal is set up again.
 */

import spec from "./emgSettings.json";

export type EmgSettingKey = keyof typeof spec.settings;
export type EmgSettingGroup = "stream" | "check" | "calibration" | "signal";
export type EmgSettings = Record<EmgSettingKey, number>;
export type EmgOverrides = Partial<EmgSettings>;

export interface EmgSettingSpec {
  group: EmgSettingGroup;
  default: number;
  min: number;
  max: number;
  integer: boolean;
  unit: string;
}

export const EMG_SETTINGS_SPEC = spec.settings as Record<EmgSettingKey, EmgSettingSpec>;
export const EMG_SETTING_KEYS = Object.keys(EMG_SETTINGS_SPEC) as EmgSettingKey[];
export const EMG_SETTING_GROUPS: readonly EmgSettingGroup[] = [
  "stream",
  "check",
  "calibration",
  "signal",
];

export const EMG_DEFAULTS: Readonly<EmgSettings> = Object.freeze(
  Object.fromEntries(
    EMG_SETTING_KEYS.map((key) => [key, EMG_SETTINGS_SPEC[key].default]),
  ) as EmgSettings,
);

/** The settings in force: the defaults with the admin's changes. Read it at use, never copy it. */
export const EMG: EmgSettings = { ...EMG_DEFAULTS };

/** Why a value cannot be used, or null. */
export function settingProblem(
  key: EmgSettingKey,
  value: unknown,
): "number" | "integer" | "range" | null {
  const rule = EMG_SETTINGS_SPEC[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return "number";
  if (rule.integer && !Number.isInteger(value)) return "integer";
  if (value < rule.min || value > rule.max) return "range";
  return null;
}

/** Rules between settings (the server has the same). */
export function crossProblems(values: EmgSettings): EmgSettingKey[] {
  const wrong: EmgSettingKey[] = [];
  if (values.minRateHz >= values.maxRateHz) wrong.push("minRateHz", "maxRateHz");
  return wrong;
}

/** Only the known keys with usable values; anything else is left at its default. */
export function cleanOverrides(raw: unknown): EmgOverrides {
  const clean: EmgOverrides = {};
  if (typeof raw !== "object" || raw === null) return clean;
  for (const key of EMG_SETTING_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined && settingProblem(key, value) === null) clean[key] = value as number;
  }
  const merged = { ...EMG_DEFAULTS, ...clean };
  if (crossProblems(merged).length > 0) {
    delete clean.minRateHz;
    delete clean.maxRateHz;
  }
  return clean;
}

const listeners = new Set<() => void>();

/** Puts the admin's changes in force (on top of the defaults; unknown or bad values ignored). */
export function applyEmgSettings(overrides: unknown): void {
  Object.assign(EMG, EMG_DEFAULTS, cleanOverrides(overrides));
  listeners.forEach((listener) => listener());
}

/** Back to the defaults. */
export function resetEmgSettings(): void {
  applyEmgSettings({});
}

/** Called after every change (the engine sets up its smoothing again). */
export function onEmgSettingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The keys whose value differs from the default. */
export function changedKeys(values: EmgSettings = EMG): EmgSettingKey[] {
  return EMG_SETTING_KEYS.filter((key) => values[key] !== EMG_DEFAULTS[key]);
}
