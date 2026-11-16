import clsx from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "bg-surface text-ink min-w-0 rounded-xl border border-black/10 p-4 shadow-[0_1px_2px_rgba(16,40,45,0.04)] sm:p-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
