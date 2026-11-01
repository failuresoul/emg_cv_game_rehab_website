import clsx from "clsx";
import { type TextareaHTMLAttributes, useId } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export function Textarea({ label, error, id, className, ...props }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const errorId = `${textareaId}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={textareaId} className="font-medium">
        {label}
      </label>
      <textarea
        id={textareaId}
        rows={3}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={clsx(
          "bg-surface min-h-11 rounded-lg border px-3 py-2",
          error ? "border-danger" : "border-muted",
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
