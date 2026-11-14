import clsx from "clsx";
import { useId, useState } from "react";

import { Switch } from "@/components/ui/Switch";
import { type DisplayChange, useAuth } from "@/features/auth/AuthContext";
import { t, type TranslationKey } from "@/i18n";
import type { TextSize } from "@/types/api";

const SIZES: { value: TextSize; labelKey: TranslationKey; sample: string }[] = [
  { value: "normal", labelKey: "display.size.normal", sample: "text-base" },
  { value: "large", labelKey: "display.size.large", sample: "text-lg" },
  { value: "xlarge", labelKey: "display.size.xlarge", sample: "text-xl" },
];

/**
 * The patient's display settings: text size, high contrast, less motion, sounds and spoken
 * instructions. Saved to the profile, so they follow the patient to any device. Used on the
 * profile page and from the session's top bar.
 */
export function DisplayControls({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { user, changeDisplay } = useAuth();
  const profile = user?.patient_profile;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const sizeLabel = useId();
  if (!profile) return null;

  async function save(change: DisplayChange) {
    setSaving(true);
    setFailed(false);
    try {
      await changeDisplay(change);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const size = profile.text_size ?? "normal";
  const toggles: {
    key: keyof DisplayChange;
    labelKey: TranslationKey;
    hintKey: TranslationKey;
    on: boolean;
  }[] = [
    {
      key: "high_contrast",
      labelKey: "display.contrast",
      hintKey: "display.contrastHint",
      on: profile.high_contrast === true,
    },
    {
      key: "reduce_motion",
      labelKey: "display.motion",
      hintKey: "display.motionHint",
      on: profile.reduce_motion === true,
    },
    {
      key: "sound_on",
      labelKey: "display.sound",
      hintKey: "display.soundHint",
      on: profile.sound_on !== false,
    },
    {
      key: "voice_on",
      labelKey: "display.voice",
      hintKey: "display.voiceHint",
      on: profile.voice_on === true,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p id={sizeLabel} className="font-semibold">
          {t("display.size")}
        </p>
        <div role="radiogroup" aria-labelledby={sizeLabel} className="flex flex-wrap gap-2">
          {SIZES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={size === option.value}
              disabled={saving}
              onClick={() => void save({ text_size: option.value })}
              className={clsx(
                "min-h-11 rounded-lg border-2 px-4 font-semibold",
                option.sample,
                size === option.value
                  ? "border-primary bg-primary text-white"
                  : tone === "dark"
                    ? "border-white/40 text-white hover:bg-white/10"
                    : "border-primary/40 text-ink hover:bg-primary-light",
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>
      {toggles.map((toggle) => (
        <div key={toggle.key} className="flex flex-col">
          <Switch
            checked={toggle.on}
            disabled={saving}
            label={t(toggle.labelKey)}
            onChange={(on) => void save({ [toggle.key]: on })}
          />
          <p className={tone === "dark" ? "text-white/80" : "text-muted"}>{t(toggle.hintKey)}</p>
        </div>
      ))}
      {failed && (
        <p role="alert" className="text-danger font-medium">
          {t("patient.profile.settingError")}
        </p>
      )}
    </div>
  );
}
