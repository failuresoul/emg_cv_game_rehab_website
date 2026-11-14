import clsx from "clsx";
import { useState } from "react";

import { useOptionalAuth } from "@/features/auth/AuthContext";
import { t } from "@/i18n";
import type { Language } from "@/types/api";

/** Each language is named in itself, so anyone can find their own. */
const OPTIONS: {
  value: Language;
  labelKey: "languageSwitch.en" | "languageSwitch.bn";
  lang: string;
}[] = [
  { value: "en", labelKey: "languageSwitch.en", lang: "en" },
  { value: "bn", labelKey: "languageSwitch.bn", lang: "bn" },
];

/**
 * English / বাংলা. For a patient the choice is saved to their profile, so their feedback reports
 * follow it; for visitors and admins it is kept in this browser.
 */
export function LanguageSwitch({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const auth = useOptionalAuth();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!auth) return null;
  const { language, changeLanguage } = auth;

  async function choose(next: Language) {
    if (next === language || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await changeLanguage(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div
        role="group"
        aria-label={t("languageSwitch.label")}
        className="flex rounded-lg border border-current/20 p-0.5"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            lang={option.lang}
            aria-pressed={language === option.value}
            disabled={saving}
            onClick={() => void choose(option.value)}
            className={clsx(
              "min-h-11 min-w-11 rounded-md px-3 font-semibold disabled:cursor-wait",
              language === option.value
                ? tone === "dark"
                  ? "bg-white text-black"
                  : "bg-primary text-white"
                : tone === "dark"
                  ? "text-white hover:bg-white/10"
                  : "text-ink hover:bg-primary-light",
            )}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      {failed && (
        <span role="alert" className="text-danger text-sm font-medium">
          {t("languageSwitch.error")}
        </span>
      )}
    </div>
  );
}
