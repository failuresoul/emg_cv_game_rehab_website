import { Check } from "lucide-react";

import { t, type TranslationKey } from "@/i18n";

const FINGER_KEYS: TranslationKey[] = [
  "warmup.sequence.index",
  "warmup.sequence.middle",
  "warmup.sequence.ring",
  "warmup.sequence.little",
];

/** The fingers of the current sequence: touched ones ticked, the next one highlighted. */
export function SequenceProgress({ step }: { step: number }) {
  return (
    <ol
      aria-label={t("warmup.sequence.label", { done: step, total: FINGER_KEYS.length })}
      className="grid grid-cols-4 gap-2"
    >
      {FINGER_KEYS.map((key, index) => {
        const done = index < step;
        const next = index === step;
        return (
          <li
            key={key}
            aria-current={next ? "step" : undefined}
            className={`flex min-h-16 flex-col items-center justify-center rounded-lg border-2 p-2 text-center font-semibold ${
              next
                ? "border-accent text-accent"
                : done
                  ? "border-primary bg-primary text-white"
                  : "border-muted/40 text-muted"
            }`}
          >
            {done && <Check size={20} aria-hidden />}
            {t(key)}
          </li>
        );
      })}
    </ol>
  );
}
