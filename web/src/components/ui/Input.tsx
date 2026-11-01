import clsx from "clsx";
import { type InputHTMLAttributes, type ReactNode, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Shown inside the right edge of the input, such as a show/hide button. */
  trailing?: ReactNode;
}

export function Input({ label, hint, error, trailing, id, className, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = clsx(hint && hintId, error && errorId) || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={clsx(
            "bg-surface min-h-11 w-full rounded-lg border px-3",
            error ? "border-danger" : "border-muted",
            trailing && "pr-14",
            className,
          )}
          {...props}
        />
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center">{trailing}</div>}
      </div>
      {hint && (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
