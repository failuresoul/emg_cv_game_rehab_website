import type { ButtonHTMLAttributes } from "react";

import { type ButtonSize, type ButtonVariant, buttonClasses } from "./buttonStyles";
import { Spinner } from "./Spinner";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && <Spinner size={20} />}
      {children}
    </button>
  );
}
