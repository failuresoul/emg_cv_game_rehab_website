import { Activity, RotateCcw, Save } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  crossProblems,
  EMG_DEFAULTS,
  EMG_SETTING_GROUPS,
  EMG_SETTING_KEYS,
  EMG_SETTINGS_SPEC,
  type EmgOverrides,
  type EmgSettingKey,
  type EmgSettings,
  settingProblem,
} from "@/emg/emgSettings";
import { t, type TranslationKey } from "@/i18n";
import { formatDateTime, formatNumber } from "@/lib/format";

import { useEmgSettings, useResetEmgSettings, useSaveEmgSettings } from "./emgSettingsApi";

type Drafts = Record<EmgSettingKey, string>;

const toDrafts = (values: EmgSettings): Drafts =>
  Object.fromEntries(EMG_SETTING_KEYS.map((key) => [key, String(values[key])])) as Drafts;

const showNumber = (key: EmgSettingKey, value: number) =>
  formatNumber(value, EMG_SETTINGS_SPEC[key].integer ? 0 : 2);

/** Why each draft cannot be saved (only the fields with a problem). */
export function draftErrors(drafts: Drafts): Partial<Record<EmgSettingKey, string>> {
  const errors: Partial<Record<EmgSettingKey, string>> = {};
  const values = { ...EMG_DEFAULTS } as EmgSettings;
  for (const key of EMG_SETTING_KEYS) {
    const text = drafts[key].trim();
    const value = text === "" ? Number.NaN : Number(text);
    const problem = settingProblem(key, value);
    if (problem === "range") {
      const rule = EMG_SETTINGS_SPEC[key];
      errors[key] = t("emgSettings.error.range", {
        min: showNumber(key, rule.min),
        max: showNumber(key, rule.max),
      });
    } else if (problem !== null) {
      errors[key] = t(
        problem === "integer" ? "emgSettings.error.integer" : "emgSettings.error.number",
      );
    } else {
      values[key] = value;
    }
  }
  for (const key of crossProblems(values)) errors[key] ??= t("emgSettings.error.order");
  return errors;
}

/** The changes to send: only the values that differ from their default. */
export function overridesFrom(drafts: Drafts): EmgOverrides {
  const overrides: EmgOverrides = {};
  for (const key of EMG_SETTING_KEYS) {
    const value = Number(drafts[key]);
    if (value !== EMG_DEFAULTS[key]) overrides[key] = value;
  }
  return overrides;
}

/** The admin's "EMG settings" panel: every threshold by group, its default, save and reset. */
export function EmgSettingsPanel() {
  const query = useEmgSettings();
  // A new form whenever the stored settings change (loaded, saved or reset).
  return (
    <EmgSettingsForm
      key={`${query.dataUpdatedAt}`}
      overrides={query.data?.overrides ?? {}}
      updatedAt={query.data?.updated_at ?? null}
    />
  );
}

function EmgSettingsForm({
  overrides,
  updatedAt,
}: {
  overrides: EmgOverrides;
  updatedAt: string | null;
}) {
  const save = useSaveEmgSettings();
  const reset = useResetEmgSettings();
  const showToast = useToast();
  const [drafts, setDrafts] = useState<Drafts>(() =>
    toDrafts({ ...EMG_DEFAULTS, ...overrides } as EmgSettings),
  );

  const errors = draftErrors(drafts);
  const valid = Object.keys(errors).length === 0;
  const busy = save.isPending || reset.isPending;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    save.mutate(overridesFrom(drafts), {
      onSuccess: () => showToast("success", t("emgSettings.saved")),
      onError: () => showToast("error", t("emgSettings.saveError")),
    });
  }

  function resetAll() {
    reset.mutate(undefined, {
      onSuccess: () => showToast("success", t("emgSettings.resetDone")),
      onError: () => showToast("error", t("emgSettings.saveError")),
    });
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-5" aria-labelledby="emg-settings-title">
        <div className="flex flex-col gap-1">
          <h2 id="emg-settings-title" className="flex items-center gap-2 text-xl font-bold">
            <Activity size={22} aria-hidden className="text-primary" />
            {t("emgSettings.title")}
          </h2>
          <p className="text-muted">{t("emgSettings.intro")}</p>
          {updatedAt && (
            <p className="text-muted text-sm">
              {t("emgSettings.lastChanged", { date: formatDateTime(updatedAt) })}
            </p>
          )}
        </div>

        {EMG_SETTING_GROUPS.map((group) => (
          <fieldset key={group} className="flex flex-col gap-3">
            <legend className="mb-2 text-lg font-semibold">
              {t(`emgSettings.group.${group}` as TranslationKey)}
            </legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {EMG_SETTING_KEYS.filter((key) => EMG_SETTINGS_SPEC[key].group === group).map(
                (key) => {
                  const rule = EMG_SETTINGS_SPEC[key];
                  const changed = Number(drafts[key]) !== EMG_DEFAULTS[key];
                  return (
                    <Input
                      key={key}
                      name={key}
                      type="number"
                      inputMode="decimal"
                      step={rule.integer ? 1 : "any"}
                      min={rule.min}
                      max={rule.max}
                      label={
                        changed
                          ? `${t(`emgSettings.key.${key}` as TranslationKey)} · ${t("emgSettings.changed")}`
                          : t(`emgSettings.key.${key}` as TranslationKey)
                      }
                      hint={t("emgSettings.default", {
                        value: showNumber(key, rule.default),
                        unit: rule.unit,
                      })}
                      error={errors[key]}
                      value={drafts[key]}
                      onChange={(event) =>
                        setDrafts((previous) => ({ ...previous, [key]: event.target.value }))
                      }
                    />
                  );
                },
              )}
            </div>
          </fieldset>
        ))}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!valid || busy} loading={save.isPending}>
            <Save size={20} aria-hidden />
            {t("emgSettings.save")}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={resetAll}>
            <RotateCcw size={20} aria-hidden />
            {t("emgSettings.reset")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
