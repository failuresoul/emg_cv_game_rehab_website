import clsx from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("bg-surface text-ink rounded-xl border border-black/10 p-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}
