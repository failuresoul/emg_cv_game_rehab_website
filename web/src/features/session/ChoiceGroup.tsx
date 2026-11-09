import clsx from "clsx";
import { type ReactNode, useId } from "react";

import { t } from "@/i18n";

export interface Choice<T> {
  value: T;
  /** Read by screen readers; also shown when there is no visual content. */
  label: string;
  content?: ReactNode;
}

interface ChoiceGroupProps<T> {
  legend: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Shown under the choices, such as what the ends of a scale mean. */
  hint?: ReactNode;
  showRequired?: boolean;
  className?: string;
  choiceClassName?: string;
}

/**
 * A question with one answer, built from native radio buttons so that the arrow keys, Tab
 * and screen readers work as usual. Each choice is a large, high-contrast button.
 */
export function ChoiceGroup<T extends string | number | boolean>({
  legend,
  choices,
  value,
  onChange,
  hint,
  showRequired = false,
  className,
  choiceClassName,
}: ChoiceGroupProps<T>) {
  const name = useId();
  const errorId = `${name}-error`;
  const missing = showRequired && value === null;

  return (
    <fieldset aria-describedby={missing ? errorId : undefined} className="flex flex-col gap-3">
      <legend className="mb-3 text-xl font-bold">{legend}</legend>
      <div className={clsx("grid gap-2", className)}>
        {choices.map((choice, index) => (
          <label key={String(choice.value)} className="block">
            <input
              type="radio"
              name={name}
              value={index}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
              aria-label={choice.content ? choice.label : undefined}
              className="peer sr-only"
            />
            <span
              className={clsx(
                "border-primary text-primary flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 bg-white px-2 py-2 text-lg font-semibold transition-colors",
                "hover:bg-primary-light peer-checked:bg-primary peer-checked:text-white",
                "peer-focus-visible:outline-accent peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2",
                choiceClassName,
              )}
            >
              {choice.content ?? choice.label}
            </span>
          </label>
        ))}
      </div>
      {hint && <div className="text-muted">{hint}</div>}
      {missing && (
        <p id={errorId} className="text-danger font-medium">
          {t("cooldown.required")}
        </p>
      )}
    </fieldset>
  );
}
