import clsx from "clsx";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible words beside the switch. */
  label: string;
  /** A fuller name for screen readers, when the label alone is not enough. */
  ariaLabel?: string;
  disabled?: boolean;
}

/** An on/off switch with its label, 44 px tall. The thumb slides without animation. */
export function Switch({ checked, onChange, label, ariaLabel, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-lg pr-2 font-medium disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden
        className={clsx(
          "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2",
          checked ? "border-primary bg-primary" : "border-muted bg-surface",
        )}
      >
        <span
          className={clsx(
            "absolute size-6 rounded-full",
            checked ? "left-6 bg-white" : "bg-muted left-0.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}
