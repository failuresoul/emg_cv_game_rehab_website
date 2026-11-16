import clsx from "clsx";
import { useState } from "react";

import { useOptionalAuth } from "@/features/auth/AuthContext";
import { t } from "@/i18n";
import type { Language } from "@/types/api";

/** Each language is named in itself, so anyone can find their own. */
const OPTIONS: {
  value: Language;
  labelKey: "languageSwitch.en" | "languageSwitch.bn";
  shortKey: "languageSwitch.enShort" | "languageSwitch.bnShort";
  lang: string;
}[] = [
  { value: "en", labelKey: "languageSwitch.en", shortKey: "languageSwitch.enShort", lang: "en" },
  { value: "bn", labelKey: "languageSwitch.bn", shortKey: "languageSwitch.bnShort", lang: "bn" },
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
            aria-label={t(option.labelKey)}
            onClick={() => void choose(option.value)}
            className={clsx(
              "min-h-11 min-w-11 rounded-md px-2 font-semibold whitespace-nowrap disabled:cursor-wait sm:px-3",
              language === option.value
                ? tone === "dark"
                  ? "bg-white text-black"
                  : "bg-primary text-white"
                : tone === "dark"
                  ? "text-white hover:bg-white/10"
                  : "text-ink hover:bg-primary-light",
            )}
          >
            {/* Short names on phones, so the header fits in one line. */}
            <span aria-hidden className="sm:hidden">
              {t(option.shortKey)}
            </span>
            <span aria-hidden className="hidden sm:inline">
              {t(option.labelKey)}
            </span>
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
