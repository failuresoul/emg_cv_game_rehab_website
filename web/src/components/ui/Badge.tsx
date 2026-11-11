import clsx from "clsx";
import type { ReactNode } from "react";

type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "muted";

// Warning uses ink text because the warning colour on a light tint has low contrast.
const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-primary-light text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/20 text-ink",
  danger: "bg-danger/10 text-danger",
  // Grey, for a state that is neither good nor bad, such as "no change".
  muted: "bg-black/5 text-muted",
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-3 py-0.5 text-base font-semibold",
        variantClasses[variant],
      )}
    >
      {children}
    </span>
  );
}
