import clsx from "clsx";

import { t } from "@/i18n";
import type { Language } from "@/types/api";

const LANGUAGES: { value: Language; key: "feedback.language.en" | "feedback.language.bn" }[] = [
  { value: "en", key: "feedback.language.en" },
  { value: "bn", key: "feedback.language.bn" },
];

/** English / বাংলা: shows the report in the other language, which is written if missing. */
export function LanguageToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: Language;
  onChange: (language: Language) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={t("feedback.language.label")}
      className="inline-flex self-start rounded-lg border border-black/15 p-1 print:hidden"
    >
      {LANGUAGES.map(({ value: language, key }) => (
        <button
          key={language}
          type="button"
          lang={language}
          aria-pressed={value === language}
          disabled={disabled}
          onClick={() => {
            if (language !== value) onChange(language);
          }}
          className={clsx(
            "min-h-11 rounded-md px-4 font-semibold disabled:opacity-50",
            value === language ? "bg-primary text-white" : "text-primary hover:bg-primary-light",
          )}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );
}
