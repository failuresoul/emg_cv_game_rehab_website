import clsx from "clsx";
import { LoaderCircle } from "lucide-react";

import { t } from "@/i18n";

interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 32, className }: SpinnerProps) {
  return (
    <span role="status" aria-label={t("common.loading")} className="inline-flex">
      <LoaderCircle size={size} aria-hidden className={clsx("animate-spin", className)} />
    </span>
  );
}
